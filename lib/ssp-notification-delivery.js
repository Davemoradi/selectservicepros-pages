"use strict";
const {createClient}=require("@supabase/supabase-js");
const crypto=require("node:crypto");
const URL=process.env.SUPABASE_URL||"https://kasqtxwbsmjlisbnebku.supabase.co";
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
const workerId=()=> "ssp-email-"+crypto.randomUUID();
const waitSeconds=n=>new Date(Date.now()+n*1000).toISOString();
const emailOk=s=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s||"")) && String(s).length<=254;
function transportReady(){
 return !!(process.env.RESEND_API_KEY&&process.env.SSP_EMAIL_FROM&&emailOk(process.env.SSP_EMAIL_FROM)&&key);
}
async function sendResend(job,offer){
 const email=String(job.payload?.contractor_email||"").trim();
 if(!emailOk(email))return {ok:false,permanent:true,error:"recipient_email_missing"};
 const service=String(job.payload?.service_category||"Home service").slice(0,80);
 const price=Number(offer.price_cents||0);
 const site="https://www.selectservicepros.com/contractor-dashboard.html?tab=leads";
 const expiry=new Date(offer.expires_at).toISOString();
 const subject="New "+service+" lead available in SSP";
 const body="A "+service+" request is available in your SSP contractor dashboard.\n"+
  "Lead ZIP: "+String(job.payload?.zip||"").slice(0,10)+"\n"+
  "Offer price (charged only if accepted): $"+(price/100).toFixed(2)+"\n"+
  "Accept before: "+expiry+"\nOpen SSP: "+site+"\n"+
  "Availability and eligibility are rechecked at acceptance.";
 const ac=new AbortController();const timer=setTimeout(()=>ac.abort(),12000);
 try{
  const resp=await fetch("https://api.resend.com/emails",{
   method:"POST",
   headers:{"Authorization":"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json",
    "Idempotency-Key":"ssp-offer-"+job.id},
   body:JSON.stringify({from:process.env.SSP_EMAIL_FROM,to:[email],subject,text:body}),signal:ac.signal
  });
  const data=await resp.json().catch(()=>({}));
  if(resp.ok&&data.id)return {ok:true,provider_message_id:String(data.id)};
  const permanent=[400,401,403,404,422].includes(resp.status);
  return {ok:false,permanent,error:"provider_http_"+resp.status};
 }catch(e){return {ok:false,permanent:false,error:e.name==="AbortError"?"provider_timeout":"provider_request_failed"}}
 finally{clearTimeout(timer)}
}
async function runNotifications(){
 if(!transportReady())return {ok:false,error:"email_provider_not_configured",provider_ready:false};
 const db=createClient(URL,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:settings,error:settingsErr}=await db.from("ssp_notification_delivery_settings").select("enabled").eq("id",1).single();
 if(settingsErr)return {ok:false,error:"notification_delivery_config_unavailable"};
 if(!settings?.enabled)return {ok:false,error:"notification_worker_disabled"};
 const id=workerId();
 const {data:jobs,error}=await db.rpc("ssp_claim_offer_notifications",{p_worker:id,p_limit:5});
 if(error)return {ok:false,error:"notification_claim_failed"};
 const summary={ok:true,claimed:(jobs||[]).length,provider_accepted:0,retried:0,dead:0,obsolete:0};
 for(const job of jobs||[]){
  const settle=async (status,reason,next)=>{
   const {data,error}=await db.rpc("settle_notification",
    {p_id:job.id,p_worker:id,p_status:status,p_error:reason||null,p_next_at:next||null});
   if(error||data!==true){console.error("notification_settle_failed",job.id,error?.code||"unsettled");return false}
   return true;
  };
  try{
   const {data:offer,error:offerErr}=await db.from("lead_offers")
    .select("id,contractor_id,lead_id,status,price_cents,expires_at").eq("id",job.offer_id).maybeSingle();
   if(offerErr)throw Error("offer_lookup_failed");
   if(!offer||offer.status!=="offered"||new Date(offer.expires_at).getTime()<=Date.now()+10000){
    if(await settle("obsolete","offer_no_longer_open"))summary.obsolete++;continue;
   }
   const {data:eligible,error:eligibleErr}=await db.rpc("ssp_contractor_lead_eligible",
    {p_contractor_id:offer.contractor_id,p_lead_id:offer.lead_id});
   if(eligibleErr)throw Error("eligibility_lookup_failed");
   if(eligible!==true){if(await settle("obsolete","contractor_or_market_not_eligible"))summary.obsolete++;continue}
   const result=await sendResend(job,offer);
   if(result.ok){
    const {error:saveErr}=await db.from("notification_outbox")
     .update({provider_message_id:result.provider_message_id,provider_accepted_at:new Date().toISOString()})
     .eq("id",job.id).eq("locked_by",id).eq("status","processing");
    if(saveErr)throw Error("provider_reference_save_failed");
    if(await settle("sent",null))summary.provider_accepted++;
   }else{
    const dead=result.permanent||job.attempt_count>=5;
    const delay=Math.min(1200,30*Math.pow(3,Math.min(job.attempt_count-1,4)));
    if(await settle(dead?"dead":"retry",result.error,dead?null:waitSeconds(delay)))summary[dead?"dead":"retried"]++;
   }
  }catch(e){
   const dead=job.attempt_count>=5;
   if(await settle(dead?"dead":"retry",String(e.message||"delivery_exception").slice(0,100),dead?null:waitSeconds(90)))
    summary[dead?"dead":"retried"]++;
  }
 }
 return summary;
}
module.exports={transportReady,runNotifications,sendResend};
