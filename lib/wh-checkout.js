// Isolated customer checkout for the Brooklyn water heater pilot.
const crypto=require("crypto");
const Stripe=require("stripe");
const {createClient}=require("@supabase/supabase-js");
const uuid=/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const hash=x=>crypto.createHash("sha256").update(String(x)).digest("hex");
async function waterHeaterCheckout(req,res){
 res.setHeader("Cache-Control","no-store");
 if(req.method!=="POST")return res.status(405).json({error:"method_not_allowed"});
 if(process.env.WH_CHECKOUT_ENABLED!=="true")return res.status(503).json({error:"checkout_not_enabled"});
 if(!process.env.WH_STRIPE_SECRET_KEY||!process.env.WH_STRIPE_PUBLISHABLE_KEY||!process.env.SUPABASE_SERVICE_ROLE_KEY||!process.env.WH_STRIPE_WEBHOOK_SECRET)return res.status(503).json({error:"checkout_not_configured"});
 // This pilot preview must never charge a live Stripe account.
 const secret=process.env.WH_STRIPE_SECRET_KEY;
 const publishable=process.env.WH_STRIPE_PUBLISHABLE_KEY;
 // Return only safe key-format diagnostics. Never expose credentials or suffixes.
 if(!secret.startsWith("sk_test_")||!publishable.startsWith("pk_test_")){
   const format=(v,test,live)=>v.startsWith(test)?"test":v.startsWith(live)?"live":v.startsWith("rk_")?"restricted":v.trim()!==v?"whitespace":"invalid";
   return res.status(503).json({error:"stripe_test_keys_required",secretKeyMode:format(secret,"sk_test_","sk_live_"),publishableKeyMode:format(publishable,"pk_test_","pk_live_")});
 }
 const {id,token,accepted_terms}=req.body||{};
 if(!uuid.test(String(id||""))||typeof token!=="string"||token.length<32||accepted_terms!==true)return res.status(400).json({error:"invalid_request"});
 const sb=createClient(process.env.SUPABASE_URL||"https://kasqtxwbsmjlisbnebku.supabase.co",process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:q,error}=await sb.from("wh_pilot_quotes").select("*").eq("id",id).eq("customer_token_hash",hash(token)).maybeSingle();
 if(error||!q)return res.status(403).json({error:"not_authorized"});
 if(q.status!=="submitted"||q.customer_payment_status==="paid"||!q.media_paths?.tag||!q.media_paths?.heater)return res.status(409).json({error:"order_not_eligible"});
 if(q.capacity_gallons!==40||!/^11\d{3}$/.test(q.zip_code))return res.status(409).json({error:"online_checkout_unavailable_for_selection"});
 try{
  const stripe=Stripe(process.env.WH_STRIPE_SECRET_KEY);
  const origin=process.env.WH_SITE_ORIGIN;
  if(!origin||!/^https:\/\/[a-z0-9.-]+$/i.test(origin))return res.status(503).json({error:"checkout_origin_not_configured"});
  const session=await stripe.checkout.sessions.create({
   ui_mode:"embedded",redirect_on_completion:"if_required",
   mode:"payment",customer_email:q.customer_email,
   client_reference_id:q.id,
   line_items:[{price_data:{currency:"usd",unit_amount:199999,product_data:{name:"40-gallon water heater replacement — standard installation",description:"Subject to on-site installation verification; nonstandard work requires separate approval."}},quantity:1}],
   metadata:{purpose:"wh_installation",quote_id:q.id,price_version:"brooklyn_40g_v2"},
   payment_intent_data:{metadata:{purpose:"wh_installation",quote_id:q.id}},
   return_url:origin+"/water-heaters.html?checkout=success&session_id={CHECKOUT_SESSION_ID}",
  },{idempotencyKey:"wh_checkout_v2_"+q.id});
  const {error:saveError}=await sb.from("wh_pilot_quotes").update({stripe_checkout_session_id:session.id,customer_payment_status:"checkout_open",customer_payment_cents:199999,updated_at:new Date().toISOString()}).eq("id",q.id).eq("status","submitted").in("customer_payment_status",["not_started","checkout_open"]);
  if(saveError)return res.status(500).json({error:"checkout_state_failed"});
  return res.status(200).json({ok:true,clientSecret:session.client_secret,publishableKey:process.env.WH_STRIPE_PUBLISHABLE_KEY});
 }catch(e){
  const stripeError=e && typeof e.type==="string" && e.type.startsWith("Stripe");
  const code=stripeError && typeof e.code==="string" ? e.code : "checkout_unavailable";
  console.error("wh checkout failed",JSON.stringify({type:e?.type||"unknown",code:e?.code||null,status:e?.statusCode||null,message:e?.message||null}));
  return res.status(500).json({error:"checkout_unavailable",detail:stripeError && e.type==="StripeInvalidRequestError" ? String(e.message||"").slice(0,240) : null,code});
 }
}
module.exports.waterHeaterCheckout=waterHeaterCheckout;
