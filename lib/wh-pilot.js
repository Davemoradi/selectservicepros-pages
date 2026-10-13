// NYC water heater pilot. Isolated from SSP leads, wallets and Stripe.
const crypto=require("crypto");
const {createClient}=require("@supabase/supabase-js");
const {requireAdmin}=require("../lib/admin-auth");
const URL=process.env.SUPABASE_URL||"https://kasqtxwbsmjlisbnebku.supabase.co";
const BUCKET="wh-pilot-private";
const PILOT_NOTIFICATION_EMAIL="david@selectservicepros.com"; // Recipient for new lead and paid-order alerts; delivery integration pending.
const getSb=()=>createClient(URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const hash=x=>crypto.createHash("sha256").update(String(x)).digest("hex");
const str=(s,n=300)=>String(s||"").trim().slice(0,n);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const types={tag:["image/jpeg","image/png","image/webp","image/heic","image/heif"],heater:["image/jpeg","image/png","image/webp","image/heic","image/heif"],connections:["image/jpeg","image/png","image/webp","image/heic","image/heif"],video:["video/mp4","video/quicktime","video/webm"]};
const statuses=["draft","submitted","reviewing","quoted","scheduled","installed","verified","paid","warranty_closed","declined"];
const transitions={submitted:["reviewing","declined"],reviewing:["quoted","declined"],quoted:["scheduled","reviewing","declined"],scheduled:["installed","reviewing"],installed:["verified","scheduled"],verified:["paid","scheduled"],paid:["warranty_closed"],warranty_closed:[],declined:[]};
const reply=(res,status,data)=>res.status(status).json(data);
const err=(res,status,error)=>reply(res,status,{ok:false,error});
async function authorizeCustomer(sb,id,token){
 if(!uuid.test(id)||!token||token.length<32)return null;
 const {data,error}=await sb.from("wh_pilot_quotes").select("*").eq("id",id).eq("customer_token_hash",hash(token)).maybeSingle();
 return error?null:data;
}
module.exports=async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 if(!["GET","POST"].includes(req.method))return err(res,405,"method_not_allowed");
 if(!process.env.SUPABASE_SERVICE_ROLE_KEY)return err(res,503,"not_configured");
 const b=req.body||{},action=req.method==="GET"?req.query.action:b.action;
 const sb=getSb();
 try{
 if(action==="start"&&req.method==="POST"){
  if(JSON.stringify(b).length>16000)return err(res,413,"too_large");
  const required=["customer_name","customer_email","customer_phone","street_address","zip_code","property_type","fuel_type","vent_type","expansion_tank","tier_preference"];
  if(required.some(k=>!str(b[k])))return err(res,400,"missing_required_fields");
  const zip=str(b.zip_code,5);
  if(!/^11\d{3}$/.test(zip))return err(res,400,"pilot_brooklyn_only");
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(b.customer_email)))return err(res,400,"invalid_email");
  if(str(b.customer_phone).replace(/\D/g,"").length<10)return err(res,400,"invalid_phone");
  if(!["natural_gas","electric","propane","unsure"].includes(b.fuel_type)||!["atmospheric","power","direct","electric_na","unsure"].includes(b.vent_type)||!["yes","no","unsure"].includes(b.expansion_tank)||!["essential","plus","premium","unsure"].includes(b.tier_preference))return err(res,400,"invalid_equipment");
  if(b.consent_accepted!==true)return err(res,400,"consent_required");
  const ip=hash(req.headers["x-forwarded-for"]?.split(",")[0]?.trim()||"no-ip");
  const since=new Date(Date.now()-3600000).toISOString();
  const {count}=await sb.from("wh_pilot_quotes").select("id",{count:"exact",head:true}).eq("request_ip_hash",ip).gte("created_at",since);
  if((count||0)>=8)return err(res,429,"too_many_requests");
  const token=crypto.randomBytes(32).toString("hex");
  const row={client_ref:uuid.test(b.client_ref||"")?b.client_ref:crypto.randomUUID(),customer_token_hash:hash(token),request_ip_hash:ip,
   customer_name:str(b.customer_name,120),customer_email:str(b.customer_email,180),customer_phone:str(b.customer_phone,40),
   street_address:str(b.street_address,230),apartment:str(b.apartment,60),zip_code:zip,property_type:str(b.property_type,70),
   location_detail:str(b.location_detail,90),fuel_type:b.fuel_type,vent_type:b.vent_type,expansion_tank:b.expansion_tank,
   tier_preference:b.tier_preference,capacity_gallons: [30,40,50,75,80,100].includes(Number(b.capacity_gallons))?Number(b.capacity_gallons):null,
   model_number:str(b.model_number,100),access_notes:str(b.access_notes,1000),customer_notes:str(b.customer_notes,1000),consent_accepted:true};
  const {data,error}=await sb.from("wh_pilot_quotes").insert(row).select("id").single();
  if(error){console.error("wh start",error.code);return err(res,500,"request_failed")}
  await sb.from("wh_pilot_events").insert({quote_id:data.id,event_type:"created",actor:"customer",metadata:{channel:"web"}});
  return reply(res,200,{ok:true,id:data.id,token});
 }
 if(action==="sign"&&req.method==="POST"){
  const q=await authorizeCustomer(sb,b.id,b.token);
  if(!q||q.status!=="draft")return err(res,403,"request_not_editable");
  const kind=str(b.kind,20),mime=str(b.mime,60),size=Number(b.size);
  if(!types[kind]||!types[kind].includes(mime))return err(res,400,"unsupported_file_type");
  if(!Number.isSafeInteger(size)||size<1||size>(kind==="video"?45000000:10000000))return err(res,400,"file_too_large");
  const {data:files,error:listError}=await sb.storage.from(BUCKET).list(q.id,{limit:15});
  if(listError)return err(res,500,"storage_not_ready");
  if((files||[]).filter(x=>x.name&&x.name.startsWith(kind+"-")).length>=2)return err(res,409,"file_limit");
  const ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/heic":"heic","image/heif":"heif","video/mp4":"mp4","video/quicktime":"mov","video/webm":"webm"}[mime];
  const path=q.id+"/"+kind+"-"+crypto.randomUUID()+"."+ext;
  const {data,error}=await sb.storage.from(BUCKET).createSignedUploadUrl(path);
  if(error)return err(res,500,"upload_unavailable");
  return reply(res,200,{ok:true,path,uploadToken:data.token});
 }
 if(action==="submit"&&req.method==="POST"){
  const q=await authorizeCustomer(sb,b.id,b.token);
  if(!q||q.status!=="draft")return err(res,403,"request_not_editable");
  const {data:files,error:se}=await sb.storage.from(BUCKET).list(q.id,{limit:30});
  if(se)return err(res,500,"storage_unavailable");
  const paths={};
  for(const kind of Object.keys(types)){
   const match=(files||[]).find(f=>f.name?.startsWith(kind+"-")&&Number(f.metadata?.size||0)>0);
   if(match)paths[kind]=q.id+"/"+match.name;
  }
  if(!paths.tag||!paths.heater||!paths.connections)return err(res,400,"required_photos_missing");
  const {data,error}=await sb.from("wh_pilot_quotes").update({status:"submitted",submitted_at:new Date().toISOString(),media_paths:paths,updated_at:new Date().toISOString()}).eq("id",q.id).eq("status","draft").select("id").maybeSingle();
  if(error||!data)return err(res,409,"request_not_editable");
  await sb.from("wh_pilot_events").insert({quote_id:q.id,event_type:"submitted",actor:"customer",metadata:{media_kinds:Object.keys(paths)}});
  return reply(res,200,{ok:true,id:q.id,reference:"WH-"+q.id.slice(0,8).toUpperCase()});
 }
 if(["list","update","media","callback"].includes(action)){
  let ctx;
  try{ctx=await requireAdmin(req)}catch(e){return err(res,e.status||500,e.message||"admin_required")}
  // Pilot records contain private homeowner images; only owner/legacy SSP admins can access.
  if(ctx.isStaffOnly&&!ctx.isOwner)return err(res,403,"admin_required");
  if(action==="list"&&req.method==="GET"){
   const {data,error}=await sb.from("wh_pilot_quotes").select("id,status,customer_name,customer_email,customer_phone,street_address,apartment,zip_code,property_type,location_detail,fuel_type,capacity_gallons,vent_type,expansion_tank,tier_preference,model_number,access_notes,customer_notes,media_paths,quoted_price_cents,equipment_cost_cents,installation_cost_cents,additional_cost_cents,installer_company,installer_phone,installer_license,review_notes,scheduled_at,installed_at,verified_at,paid_at,payout_reference,payout_paid_cents,warranty_closes_at,submitted_at,created_at,updated_at").neq("status","draft").order("created_at",{ascending:false}).limit(200);
   if(error)return err(res,500,"list_unavailable");
   return reply(res,200,{ok:true,quotes:data||[]});
  }
  if(action==="media"&&req.method==="POST"){
   if(!uuid.test(b.id))return err(res,400,"invalid_id");
   const {data:q}=await sb.from("wh_pilot_quotes").select("media_paths").eq("id",b.id).maybeSingle();
   const path=q?.media_paths?.[b.kind];
   if(!path||!path.startsWith(b.id+"/"))return err(res,404,"media_not_found");
   const {data,error}=await sb.storage.from(BUCKET).createSignedUrl(path,60);
   if(error)return err(res,500,"media_unavailable");
   return reply(res,200,{ok:true,url:data.signedUrl});
  }
  if(action==="update"&&req.method==="POST"){
   if(!uuid.test(b.id))return err(res,400,"invalid_id");
   const {data:q}=await sb.from("wh_pilot_quotes").select("*").eq("id",b.id).maybeSingle();
   if(!q||q.status==="draft")return err(res,404,"not_found");
   const desired=str(b.status,30);
   if(!transitions[q.status]?.includes(desired))return err(res,409,"invalid_status_transition");
   if(["quoted","scheduled","installed","verified","paid"].includes(desired)&&!(Number(b.quoted_price_cents??q.quoted_price_cents)>0))return err(res,400,"quote_required");
   if(["scheduled","installed","verified","paid"].includes(desired)&&!str(b.installer_company??q.installer_company))return err(res,400,"installer_required");
   if(["scheduled","installed","verified","paid"].includes(desired)&&!str(b.installer_license??q.installer_license))return err(res,400,"license_required");
   if(desired==="scheduled"&&!b.scheduled_at&&!q.scheduled_at)return err(res,400,"schedule_required");
   if(desired==="paid"&&!str(b.payout_reference)||desired==="paid"&&!(Number(b.payout_paid_cents)>0))return err(res,400,"manual_payout_details_required");
   const updates={status:desired,updated_at:new Date().toISOString()};
   if(["reviewing","quoted","scheduled","installed","verified"].includes(desired)){
     for(const k of ["installer_company","installer_phone","installer_license","review_notes"]){if(k in b)updates[k]=str(b[k],k==="review_notes"?1500:200)}
     for(const k of ["quoted_price_cents","equipment_cost_cents","installation_cost_cents","additional_cost_cents"]){if(k in b){const v=Number(b[k]);if(!Number.isSafeInteger(v)||v<0||v>2000000)return err(res,400,"invalid_price");updates[k]=v}}
     if(b.scheduled_at){const d=new Date(b.scheduled_at);if(Number.isNaN(d.getTime()))return err(res,400,"invalid_schedule");updates.scheduled_at=d.toISOString()}
   }
   const now=new Date().toISOString();
   if(desired==="installed")updates.installed_at=now;
   if(desired==="verified")updates.verified_at=now;
   if(desired==="paid"){updates.paid_at=now;updates.payout_reference=str(b.payout_reference,150);updates.payout_paid_cents=Number(b.payout_paid_cents)}
   if(desired==="warranty_closed"){
     const until=q.warranty_closes_at?new Date(q.warranty_closes_at):null;
     if(!until||until.getTime()>Date.now())return err(res,409,"warranty_still_active");
     const {count}=await sb.from("wh_pilot_callbacks").select("id",{count:"exact",head:true}).eq("quote_id",q.id).eq("status","open");
     if(count)return err(res,409,"open_callback");
   }
   if(desired==="installed")updates.warranty_closes_at=new Date(Date.now()+30*86400000).toISOString();
   const {data,error}=await sb.from("wh_pilot_quotes").update(updates).eq("id",q.id).eq("status",q.status).select("id").maybeSingle();
   if(error||!data)return err(res,409,"concurrent_update");
   await sb.from("wh_pilot_events").insert({quote_id:q.id,event_type:"status_"+desired,actor:ctx.user.email,metadata:{from:q.status,to:desired,payout_reference:desired==="paid"?str(b.payout_reference):undefined}});
   return reply(res,200,{ok:true,id:q.id,status:desired});
  }
  if(action==="callback"&&req.method==="POST"){
   if(!uuid.test(b.id))return err(res,400,"invalid_id");
   const {data:q}=await sb.from("wh_pilot_quotes").select("id,status,installed_at").eq("id",b.id).maybeSingle();
   if(!q||!q.installed_at)return err(res,409,"not_installed");
   const note=str(b.description,1200);
   if(note.length<10)return err(res,400,"callback_description_required");
   const {error}=await sb.from("wh_pilot_callbacks").insert({quote_id:q.id,description:note,opened_by:ctx.user.email});
   if(error)return err(res,500,"callback_failed");
   await sb.from("wh_pilot_events").insert({quote_id:q.id,event_type:"callback_opened",actor:ctx.user.email});
   return reply(res,200,{ok:true});
  }
 }
 return err(res,404,"unknown_action");
 }catch(e){console.error("wh pilot",String(e?.message||e).slice(0,180));return err(res,500,"server_error")}
};
