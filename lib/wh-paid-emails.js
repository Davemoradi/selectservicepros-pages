// Paid water-heater order notifications. Invoked only after Stripe-verified paid state.
const {createClient}=require("@supabase/supabase-js");
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ref=id=>"WH-"+id.slice(0,8).toUpperCase();
const email=(title,body)=>`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f5f7f9;padding:28px 12px;font-family:Arial,sans-serif;color:#173047"><table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;margin:auto;background:white;border-radius:14px;border:1px solid #e3e8ee"><tr><td style="background:#0c2943;padding:24px 28px;color:white"><div style="font-size:13px;font-weight:bold;letter-spacing:1.3px">NEW YORK <span style="color:#ff8355">WATER HEATER PROS</span></div></td></tr><tr><td style="padding:30px 28px"><h1 style="font-size:25px;margin:0 0 18px;color:#0c2943">${esc(title)}</h1>${body}<p style="font-size:12px;color:#708092;margin-top:32px">New York Water Heater Pros · Brooklyn, New York</p></td></tr></table></body></html>`;
function createNotifier(sb) {
 return async function sendPaidEmails(id){
  if(!process.env.WH_RESEND_API_KEY||!process.env.WH_EMAIL_FROM)return {configured:false};
  const {data:q,error}=await sb.from("wh_pilot_quotes").select("id,customer_payment_status,customer_name,customer_email,customer_phone,street_address,apartment,zip_code,capacity_gallons,customer_payment_cents,customer_confirmation_email_sent_at,admin_paid_alert_email_sent_at").eq("id",id).maybeSingle();
  if(error||!q||q.customer_payment_status!=="paid"||q.customer_payment_cents!==199999||q.capacity_gallons!==40)return {eligible:false};
  const order=ref(q.id);
  const address=[q.street_address,q.apartment,q.zip_code].filter(Boolean).map(esc).join(", ");
  const customerBody=`<p>Hi ${esc(q.customer_name)},</p><p><strong>Your payment of $1,999.99 has been confirmed.</strong> Thank you for choosing New York Water Heater Pros.</p><p><strong>Order reference:</strong> ${order}<br><strong>Service:</strong> A. O. Smith 40-gallon water heater replacement, standard installation<br><strong>Installation address:</strong> ${address}</p><p>Our team will review your submitted installation photos and contact you to confirm installation details and scheduling. Your payment does not mean that an appointment has been booked yet.</p><p>If any additional work is required, we will explain the cost and request your approval before proceeding.</p><p>Thank you,<br><strong>New York Water Heater Pros</strong></p>`;
  const adminBody=`<p>A water-heater payment has been confirmed and requires installation review.</p><p><strong>Reference:</strong> ${order}<br><strong>Customer:</strong> ${esc(q.customer_name)}<br><strong>Email:</strong> ${esc(q.customer_email)}<br><strong>Phone:</strong> ${esc(q.customer_phone)}<br><strong>Address:</strong> ${address}<br><strong>Product:</strong> 40-gallon A. O. Smith<br><strong>Paid:</strong> $1,999.99 (Stripe)</p><p><strong>Next step:</strong> Review uploaded photos, verify installation conditions, and contact the customer to schedule. Do not assume the job is scheduled.</p>`;
  const jobs=[
   {kind:"customer",sent:"customer_confirmation_email_sent_at",claim:"customer_confirmation_email_claimed_at",to:q.customer_email,subject:`Payment confirmed — ${order} | New York Water Heater Pros`,html:email("Payment confirmed",customerBody)},
   {kind:"admin",sent:"admin_paid_alert_email_sent_at",claim:"admin_paid_alert_email_claimed_at",to:process.env.WH_ADMIN_EMAIL||"david@selectservicepros.com",subject:`Paid water heater order ${order} — review needed`,html:email("New paid order",adminBody)}
  ];
  const result={configured:true};
  for(const job of jobs){
   if(!job.to){result[job.kind]="missing_recipient";continue;}
   const time=new Date().toISOString();
   const {data:claimed,error:claimError}=await sb.from("wh_pilot_quotes").update({[job.claim]:time}).eq("id",q.id).eq("customer_payment_status","paid").is(job.sent,null).is(job.claim,null).select("id").maybeSingle();
   if(claimError){result[job.kind]="claim_failed";continue}
   if(!claimed){result[job.kind]="already_sent_or_in_progress";continue}
   try{
    const response=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+process.env.WH_RESEND_API_KEY,"Content-Type":"application/json","Idempotency-Key":`nywh-${job.kind}-${q.id}`},body:JSON.stringify({from:process.env.WH_EMAIL_FROM,to:[job.to],subject:job.subject,html:job.html})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.id)throw Error("resend_status_"+response.status);
    const {error:markError}=await sb.from("wh_pilot_quotes").update({[job.sent]:new Date().toISOString()}).eq("id",q.id).eq(job.claim,time);
    if(markError)throw Error("mark_sent_failed");
    result[job.kind]="sent";
   }catch(e){
    console.error("wh notification",job.kind,String(e.message).slice(0,120));
    // Keep claim when provider delivery status is uncertain, to prevent a duplicate.
    result[job.kind]="needs_review";
   }
  }
  return result;
 }
}
async function sendPaidWaterHeaterEmails(id){
 const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!service)return {configured:false};
 const sb=createClient(process.env.SUPABASE_URL||"https://kasqtxwbsmjlisbnebku.supabase.co",service,{auth:{persistSession:false,autoRefreshToken:false}});
 return createNotifier(sb)(id);
}
module.exports={sendPaidWaterHeaterEmails};
