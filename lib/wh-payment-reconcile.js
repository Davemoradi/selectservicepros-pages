const {sendPaidWaterHeaterEmails}=require("./wh-paid-emails");
// Customer-authenticated payment reconciliation. Never trusts a browser-supplied paid flag.
const Stripe=require("stripe");
const {createClient}=require("@supabase/supabase-js");
const crypto=require("crypto");
const hash=v=>crypto.createHash("sha256").update(String(v)).digest("hex");
const validUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
module.exports=async function reconcileWaterHeaterPayment(req,res){
 if(req.method!=="POST")return res.status(405).json({ok:false,error:"method_not_allowed"});
 const {id,token}=req.body||{};
 if(!validUuid.test(String(id||""))||typeof token!=="string"||token.length<32)return res.status(400).json({ok:false,error:"invalid_request"});
 const secret=process.env.WH_STRIPE_SECRET_KEY,service=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!secret||!secret.startsWith("sk_test_")||!service)return res.status(503).json({ok:false,error:"not_configured"});
 const sb=createClient(process.env.SUPABASE_URL||"https://kasqtxwbsmjlisbnebku.supabase.co",service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:q,error:readError}=await sb.from("wh_pilot_quotes").select("id,customer_token_hash,stripe_checkout_session_id,customer_payment_status,customer_payment_cents,capacity_gallons").eq("id",id).maybeSingle();
 if(readError)return res.status(500).json({ok:false,error:"lookup_failed"});
 if(!q||q.customer_token_hash!==hash(token))return res.status(403).json({ok:false,error:"not_authorized"});
 if(q.customer_payment_status==="paid"){try{await sendPaidWaterHeaterEmails(q.id)}catch(e){console.error("wh email after paid status",e.message)}return res.status(200).json({ok:true,status:"paid"});}
 if(!q.stripe_checkout_session_id)return res.status(409).json({ok:false,error:"checkout_not_started"});
 try{
  const session=await Stripe(secret).checkout.sessions.retrieve(q.stripe_checkout_session_id);
  if(session.payment_status!=="paid")return res.status(200).json({ok:true,status:"pending"});
  if(session.mode!=="payment"||session.currency!=="usd"||session.amount_total!==199999||
    session.metadata?.purpose!=="wh_installation"||session.metadata?.price_version!=="brooklyn_40g_v2"||
    session.metadata?.quote_id!==q.id||session.client_reference_id!==q.id||
    q.customer_payment_cents!==199999||q.capacity_gallons!==40)
    return res.status(409).json({ok:false,error:"payment_mismatch"});
  const now=new Date().toISOString();
  const {data:updated,error:writeError}=await sb.from("wh_pilot_quotes").update({
   customer_payment_status:"paid",customer_paid_at:now,inspection_status:"pending",
   stripe_payment_intent_id:typeof session.payment_intent==="string"?session.payment_intent:null,updated_at:now
  }).eq("id",q.id).eq("stripe_checkout_session_id",session.id).eq("customer_payment_status","checkout_open").select("id").maybeSingle();
  if(writeError)return res.status(500).json({ok:false,error:"update_failed"});
  if(updated){await sb.from("wh_pilot_events").insert({quote_id:q.id,event_type:"customer_payment_reconciled",actor:"stripe_verified_checkout",metadata:{session_id:session.id,amount_cents:199999}});try{await sendPaidWaterHeaterEmails(q.id)}catch(e){console.error("wh email after reconciliation",e.message)}}
  return res.status(200).json({ok:true,status:"paid"});
 }catch(e){console.error("wh reconcile",e.type||e.message);return res.status(502).json({ok:false,error:"stripe_verification_unavailable"})}
};
