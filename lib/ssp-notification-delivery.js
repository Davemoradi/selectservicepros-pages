"use strict";
/**
 * SSP lead offers -> GoHighLevel conversations. Delivery is disabled until
 * GHL_PRIVATE_INTEGRATION_TOKEN and GHL_LOCATION_ID are configured AND the
 * ssp_notification_delivery_settings switch is enabled.
 * Each opted-in channel uses its own outbox idempotency key.
 * GHL message accepted != delivered. Unknown send state is never retried.
 */
const {createClient}=require("@supabase/supabase-js");
const crypto=require("node:crypto");
const SUPABASE_URL=process.env.SUPABASE_URL||"https://kasqtxwbsmjlisbnebku.supabase.co";
const API="https://services.leadconnectorhq.com";
const DASHBOARD="https://www.selectservicepros.com/contractor-dashboard.html?tab=leads";
const waitSeconds=n=>new Date(Date.now()+n*1000).toISOString();
const emailOk=s=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s||""))&&String(s).length<=254;
function normalizeUsPhone(value) {
 const raw=String(value||"").trim(),digits=raw.replace(/[^0-9]/g,"");
 if(digits.length===10)return "+1"+digits;
 if(digits.length===11&&digits[0]==="1")return "+"+digits;
 return null;
}
function transportReady(){
 return !!(process.env.GHL_PRIVATE_INTEGRATION_TOKEN&&process.env.GHL_LOCATION_ID&&
   process.env.SUPABASE_SERVICE_ROLE_KEY);
}
function classification(job,contractor){
 const sms=job.event_type==="lead_offer_created_sms";
 if(sms){
  if(contractor.notif_sms!==true)return {channel:"sms",reason:"sms_not_opted_in"};
  const phone=normalizeUsPhone(contractor.phone);
  return phone?{channel:"sms",phone}:{channel:"sms",reason:"phone_missing_or_invalid"};
 }
 if(job.event_type!=="lead_offer_created")return {channel:"invalid",reason:"unsupported_outbox_event"};
 if(contractor.notif_email===false)return {channel:"email",reason:"email_notifications_disabled"};
 const email=String(contractor.email||"").trim();
 return emailOk(email)?{channel:"email",email}:{channel:"email",reason:"email_missing_or_invalid"};
}
function buildOfferMessage(offer,job,channel){
 const service=String(job.payload?.service_category||"home service").replace(/[^a-zA-Z0-9 /-]/g,"").slice(0,54)||"home service";
 const zip=String(job.payload?.zip||"").replace(/[^0-9]/g,"").slice(0,5);
 const price=(Number(offer.price_cents||0)/100).toFixed(2);
 const link=DASHBOARD;
 if(channel==="sms"){
  return "SSP: New "+service+" lead"+(zip?" ("+zip+")":"")+". Offer $"+price+
   " (charged only if accepted). View before it expires: "+link+" Reply STOP to opt out.";
 }
 return "SSP has a new "+service+" lead available"+(zip?" in ZIP "+zip:"")+".\n"+
   "Offer price: $"+price+" (charged only if accepted).\n"+
   "Offer expires: "+new Date(offer.expires_at).toISOString()+".\n"+
   "Log in to view and accept: "+link+"\n"+
   "Eligibility and availability are checked again at acceptance.";
}
async function ghlRequest(path,body,fetcher=fetch){
 const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),10000);
 try{
  const resp=await fetcher(API+path,{method:"POST",
   headers:{"Authorization":"Bearer "+process.env.GHL_PRIVATE_INTEGRATION_TOKEN,
    "Version":"v3","Content-Type":"application/json","Accept":"application/json"},
   body:JSON.stringify(body),signal:ac.signal
  });
  const response=await resp.json().catch(()=>({}));
  if(!resp.ok){
   const e=new Error("ghl_http_"+resp.status);e.httpStatus=resp.status;throw e;
  }
  return response;
 }finally{clearTimeout(timer)}
}
async function upsertContact(contractor,channel,fetcher=fetch){
 const payload={
  locationId:process.env.GHL_LOCATION_ID,
  firstName:String(contractor.first_name||"").slice(0,80),
  lastName:String(contractor.last_name||"").slice(0,80),
  source:"SSP Contractor",
  createNewIfDuplicateAllowed:false
 };
 // Identify one contact on the opted-in channel; never merge unrelated contacts by email+phone.
 if(channel.channel==="sms")payload.phone=channel.phone;
 else payload.email=channel.email;
 const response=await ghlRequest("/contacts/upsert",payload,fetcher);
 const id=response?.contact?.id;
 if(typeof id!=="string"||!id)throw Error("ghl_contact_not_returned");
 return id;
}
async function sendGhlMessage(contactId,offer,job,channel,fetcher=fetch){
 const sms=channel.channel==="sms";
 const body={type:sms?"SMS":"Email",contactId,status:"pending",
   message:buildOfferMessage(offer,job,channel.channel)};
 if(sms){
  body.toNumber=channel.phone;
  if(process.env.GHL_FROM_NUMBER)body.fromNumber=process.env.GHL_FROM_NUMBER;
 }else{
  body.subject="SSP "+String(job.payload?.service_category||"service").slice(0,45)+" lead available";
  body.emailTo=channel.email;
  if(process.env.GHL_EMAIL_FROM)body.emailFrom=process.env.GHL_EMAIL_FROM;
 }
 const data=await ghlRequest("/conversations/messages",body,fetcher);
 if(typeof data.messageId!=="string"||!data.messageId)throw Error("ghl_message_id_missing");
 return {messageId:data.messageId,conversationId:data.conversationId||null};
}
async function runNotifications(options={}){
 if(!transportReady())return {ok:false,error:"ghl_not_configured",provider_ready:false};
 const db=options.db||createClient(SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,
   {auth:{persistSession:false,autoRefreshToken:false}});
 const fetcher=options.fetcher||fetch;
 const {data:settings,error:settingsErr}=await db.from("ssp_notification_delivery_settings")
  .select("enabled,provider").eq("id",1).single();
 if(settingsErr)return {ok:false,error:"notification_settings_unavailable"};
 if(settings?.provider!=="ghl"||settings.enabled!==true)return {ok:false,error:"notification_worker_disabled"};
 const worker="ssp-ghl-"+crypto.randomUUID();
 const {data:jobs,error}=await db.rpc("ssp_claim_offer_notifications",{p_worker:worker,p_limit:5});
 if(error)return {ok:false,error:"notification_claim_failed"};
 const result={ok:true,claimed:(jobs||[]).length,provider_accepted:0,retried:0,dead:0,obsolete:0};
 for(const job of jobs||[]){
  const settle=async (status,reason,nextAt)=>{
   const {data,error}=await db.rpc("settle_notification",{
    p_id:job.id,p_worker:worker,p_status:status,
    p_error:reason||null,p_next_at:nextAt||null
   });
   if(error||data!==true){console.error("ghl_settlement_unconfirmed",job.id,error?.code||"unknown");return false}
   return true;
  };
  const finish=async (status,reason,nextAt)=>{
   const ok=await settle(status,reason,nextAt);
   if(ok)result[status==="sent"?"provider_accepted":status==="retry"?"retried":status]++;
  };
  const backoff=()=>waitSeconds(Math.min(600,30*Math.pow(2,Math.min(job.attempt_count-1,4))));
  try{
   // A provider message ID means GHL accepted it, even if settlement previously failed.
   if(job.provider_message_id){await finish("sent",null);continue}
   // No GHL request-level idempotency is guaranteed by the published API.
   // A previous ambiguous attempt must not be sent again.
   if(job.provider_send_started_at){await finish("dead","delivery_uncertain_manual_review");continue}
   const {data:offer,error:oe}=await db.from("lead_offers")
    .select("id,contractor_id,lead_id,status,price_cents,expires_at")
    .eq("id",job.offer_id).maybeSingle();
   if(oe)throw Error("offer_lookup_failed");
   if(!offer||offer.status!=="offered"||new Date(offer.expires_at).getTime()<=Date.now()+20000){
    await finish("obsolete","offer_no_longer_open");continue;
   }
   const {data:contractor,error:ce}=await db.from("contractors")
    .select("id,first_name,last_name,email,phone,notif_email,notif_sms,status")
    .eq("id",offer.contractor_id).maybeSingle();
   if(ce)throw Error("contractor_lookup_failed");
   if(!contractor||contractor.status!=="Active"){await finish("obsolete","contractor_not_active");continue}
   const channel=classification(job,contractor);
   if(channel.reason){await finish("obsolete",channel.reason);continue}
   const {data:eligible,error:ee}=await db.rpc("ssp_contractor_lead_eligible",
    {p_contractor_id:offer.contractor_id,p_lead_id:offer.lead_id});
   if(ee)throw Error("eligibility_lookup_failed");
   if(eligible!==true){await finish("obsolete","contractor_or_market_ineligible");continue}
   // Contact upsert may be retried: no message is sent during this stage.
   let contactId;
   try{contactId=await upsertContact(contractor,channel,fetcher)}
   catch(e){
    const http=e.httpStatus;
    await finish([400,401,403,404,422].includes(http)||job.attempt_count>=5?"dead":"retry",
      http?"ghl_contact_http_"+http:"ghl_contact_lookup_failed",backoff());
    continue;
   }
   // Never text after expiration, suspension or opt-out during contact upsert.
   const [checkOffer,checkContractor,checkElig]=await Promise.all([
    db.from("lead_offers").select("status,expires_at").eq("id",offer.id).maybeSingle(),
    db.from("contractors").select("notif_email,notif_sms,status,phone,email").eq("id",offer.contractor_id).maybeSingle(),
    db.rpc("ssp_contractor_lead_eligible",{p_contractor_id:offer.contractor_id,p_lead_id:offer.lead_id})
   ]);
   if(checkOffer.error||checkContractor.error||checkElig.error)throw Error("pre_send_check_failed");
   if(checkOffer.data?.status!=="offered"||new Date(checkOffer.data?.expires_at).getTime()<=Date.now()+12000||
      checkElig.data!==true||checkContractor.data?.status!=="Active"||
      classification(job,checkContractor.data).reason||
      (channel.channel==="sms" && normalizeUsPhone(checkContractor.data?.phone)!==channel.phone)||
      (channel.channel==="email" && String(checkContractor.data?.email||"").trim()!==channel.email)){
     await finish("obsolete","offer_changed_or_opted_out");continue;
   }
   const {error:markErr}=await db.from("notification_outbox")
    .update({provider_send_started_at:new Date().toISOString(),provider_channel:channel.channel})
    .eq("id",job.id).eq("locked_by",worker).eq("status","processing");
   if(markErr)throw Error("provider_send_barrier_failed");
   let response;
   try{response=await sendGhlMessage(contactId,offer,job,channel,fetcher)}
   catch(e){
    // Explicit rate limit guarantees provider refused; safe to retry.
    if(e.httpStatus===429){
     const {error:clearErr}=await db.from("notification_outbox").update({provider_send_started_at:null})
      .eq("id",job.id).eq("locked_by",worker).eq("status","processing");
     if(clearErr){await finish("dead","ghl_rate_limited_uncertain");continue}
     await finish("retry","ghl_rate_limited",backoff());continue;
    }
    await finish("dead",e.httpStatus?"ghl_message_http_"+e.httpStatus+"_manual_review":"ghl_send_uncertain_manual_review");
    continue;
   }
   const {error:saveErr}=await db.from("notification_outbox")
    .update({provider_message_id:response.messageId,provider_accepted_at:new Date().toISOString()})
    .eq("id",job.id).eq("locked_by",worker).eq("status","processing");
   if(saveErr){console.error("ghl_sent_but_unrecorded",job.id);continue}
   await finish("sent",null);
  }catch(e){
   const permanent=job.attempt_count>=5;
   await finish(permanent?"dead":"retry",String(e.message||"worker_failed").slice(0,110),backoff());
  }
 }
 return result;
}
module.exports={transportReady,runNotifications,normalizeUsPhone,classification,buildOfferMessage,upsertContact,sendGhlMessage};
