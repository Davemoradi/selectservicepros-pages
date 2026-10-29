const {sendPaidWaterHeaterEmails}=require("./wh-paid-emails");
// Separate Stripe endpoint: never routes water-heater payments through SSP wallet funding.
const Stripe=require("stripe");
const {createClient}=require("@supabase/supabase-js");

const raw=req=>new Promise((resolve,reject)=>{const parts=[];req.on("data",c=>parts.push(Buffer.from(c)));req.on("end",()=>resolve(Buffer.concat(parts)));req.on("error",reject)});
module.exports=async(req,res)=>{
 if(req.method!=="POST")return res.status(405).json({error:"method_not_allowed"});
 if(!process.env.WH_STRIPE_WEBHOOK_SECRET||!process.env.WH_STRIPE_SECRET_KEY||!process.env.SUPABASE_SERVICE_ROLE_KEY)return res.status(503).json({error:"not_configured"});
 const stripe=Stripe(process.env.WH_STRIPE_SECRET_KEY);
 let event;
 try{event=stripe.webhooks.constructEvent(await raw(req),req.headers["stripe-signature"],process.env.WH_STRIPE_WEBHOOK_SECRET)}
 catch(e){return res.status(400).json({error:"invalid_signature"})}
 if(!["checkout.session.completed","checkout.session.async_payment_succeeded"].includes(event.type))return res.status(200).json({ok:true,ignored:true});
 const session=event.data.object;
 if(session.metadata?.purpose!=="wh_installation"||session.payment_status!=="paid")return res.status(200).json({ok:true,ignored:true});
 const expected=session.metadata?.price_version==="brooklyn_40g_v2"?199999:session.metadata?.price_version==="brooklyn_40g_v1"?199900:null;
 if(session.currency!=="usd"||expected===null||session.amount_total!==expected||session.client_reference_id!==session.metadata.quote_id)return res.status(400).json({error:"payment_mismatch"});
 const sb=createClient(process.env.SUPABASE_URL||"https://kasqtxwbsmjlisbnebku.supabase.co",process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:q,error:readError}=await sb.from("wh_pilot_quotes").select("id,stripe_checkout_session_id,customer_payment_status,customer_payment_cents,capacity_gallons").eq("id",session.metadata.quote_id).maybeSingle();
 if(readError)return res.status(500).json({error:"lookup_failed"});
 if(!q||q.stripe_checkout_session_id!==session.id||q.customer_payment_cents!==expected||q.capacity_gallons!==40)return res.status(400).json({error:"order_mismatch"});
 if(q.customer_payment_status==="paid"){try{await sendPaidWaterHeaterEmails(q.id)}catch(e){console.error("wh email after duplicate",e.message)}return res.status(200).json({ok:true,duplicate:true})}
 const {data:updated,error}=await sb.from("wh_pilot_quotes").update({customer_payment_status:"paid",stripe_payment_intent_id:typeof session.payment_intent==="string"?session.payment_intent:null,customer_paid_at:new Date().toISOString(),inspection_status:"pending",updated_at:new Date().toISOString()}).eq("id",q.id).eq("stripe_checkout_session_id",session.id).eq("customer_payment_status","checkout_open").select("id").maybeSingle();
 if(error)return res.status(500).json({error:"update_failed"});
 if(updated){await sb.from("wh_pilot_events").insert({quote_id:q.id,event_type:"customer_payment_confirmed",actor:"stripe",metadata:{session_id:session.id,amount_cents:expected}});try{await sendPaidWaterHeaterEmails(q.id)}catch(e){console.error("wh email after webhook",e.message)}}
 return res.status(200).json({ok:true});
};