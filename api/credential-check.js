"use strict";
const {requireAdmin}=require("../lib/admin-auth");
const {lookupTdlrLicense,DATASET}=require("../lib/ssp-license-registry");
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(res,status,error)=>res.status(status).json({ok:false,error});
module.exports=async(req,res)=>{
 res.setHeader("Content-Type","application/json");res.setHeader("Cache-Control","no-store");
 if(!["GET","POST"].includes(req.method))return fail(res,405,"method_not_allowed");
 let ctx;
 try{ctx=await requireAdmin(req)}catch(e){return fail(res,e.status||500,e.message||"unauthorized")}
 if(ctx.isStaffOnly)return fail(res,403,"reviewer_required");
 const b=req.method==="POST"?(req.body||{}):(req.query||{});
 const id=String(b.contractor_id||"");
 if(!UUID.test(id))return fail(res,400,"invalid_contractor_id");
 const {data:c,error:ce}=await ctx.supabase.from("contractors").select("id,company_name,first_name,last_name,insurance_doc_url").eq("id",id).maybeSingle();
 if(ce||!c)return fail(res,404,"contractor_not_found");
 if(req.method==="GET"){
  const {data,error}=await ctx.supabase.from("operations_credential_checks").select("id,license_id,credential_kind,method,result,document_path,evidence,source_url,source_asof,checked_at,checked_by_label").eq("contractor_id",id).order("checked_at",{ascending:false}).limit(100);
  if(error)return fail(res,500,"checks_unavailable");
  return res.status(200).json({ok:true,checks:data||[],insurance_partner_status:"not_connected"});
 }
 const action=String(b.action||"");
 if(action==="check_tdlr"){
  const licId=String(b.license_id||"");if(!UUID.test(licId))return fail(res,400,"invalid_license_id");
  const {data:l,error:le}=await ctx.supabase.from("contractor_licenses").select("id,license_number,license_state,document_url").eq("id",licId).eq("contractor_id",id).maybeSingle();
  if(le||!l)return fail(res,404,"license_not_found");
  if(String(l.license_state||"").toUpperCase()!=="TX")return fail(res,400,"texas_license_only");
  if(!l.license_number)return fail(res,400,"license_number_required");
  const checked=await lookupTdlrLicense({licenseNumber:l.license_number,companyName:c.company_name,ownerName:[c.first_name,c.last_name].filter(Boolean).join(" ")});
  const {error}=await ctx.supabase.from("operations_credential_checks").insert({contractor_id:id,license_id:licId,credential_kind:"license",method:"tdlr_public_dataset",result:checked.status,document_path:l.document_url||"not_uploaded",source_url:DATASET,source_reference:String(l.license_number).slice(0,70),source_asof:checked.source_asof||null,checked_by:ctx.user.id,checked_by_label:ctx.user.email||"SSP Operations",evidence:{status:checked.status,record:checked.record||null,record_count:checked.record_count||0,verification_level:checked.verification_level,needs_human_active_status_confirmation:true}});
  if(error)return fail(res,500,"registry_evidence_save_failed");
  return res.status(200).json({ok:true,check:checked});
 }
 if(action==="attest_live_license"){
  const license_id=String(b.license_id||""),reference=String(b.reference||"").trim(),notes=String(b.notes||"").trim();
  if(!UUID.test(license_id)||reference.length<6||reference.length>160||notes.length<30||notes.length>1800||b.confirmed_active!==true)return fail(res,400,"official_license_evidence_required");
  const {data:l}=await ctx.supabase.from("contractor_licenses").select("id,license_state,license_number,document_url").eq("id",license_id).eq("contractor_id",id).maybeSingle();
  if(!l)return fail(res,404,"license_not_found");
  if(String(l.license_state||"").toUpperCase()!=="TX")return fail(res,400,"texas_license_only");
  const path=String(l.document_url||"");
  if(!path.startsWith(id+"/")||path.includes(".."))return fail(res,409,"private_document_required");
  const {data:items,error:listErr}=await ctx.supabase.storage.from("contractor-docs").list(id,{search:path.split("/").pop()});
  if(listErr||!(items||[]).some(o=>o.name===path.split("/").pop()))return fail(res,409,"source_document_not_found");
  const {error}=await ctx.supabase.from("operations_credential_checks").insert({contractor_id:id,license_id,credential_kind:"license",method:"tdlr_live_search",result:"human_attested",document_path:path,source_url:"https://www.tdlr.texas.gov/LicenseSearch/",source_reference:reference,checked_by:ctx.user.id,checked_by_label:ctx.user.email||"SSP Operations",evidence:{notes,license_number:l.license_number,checked_current_active_search:true,notice:"Human confirmation of TDLR active search, not a machine-verifiable live search API result."}});
  if(error)return fail(res,500,"license_confirmation_save_failed");
  return res.status(200).json({ok:true,status:"human_attested"});
 }
 if(action==="attest_insurance"){
  const method=String(b.method||""),ref=String(b.reference||"").trim(),contact=String(b.contact||"").trim(),notes=String(b.notes||"").trim();
  if(!["insurer_direct","broker_direct"].includes(method)||ref.length<8||ref.length>180||contact.length<3||contact.length>160||notes.length<30||notes.length>1800||b.confirmed_active!==true)return fail(res,400,"confirmation_evidence_required");
  const path=String(c.insurance_doc_url||"");
  if(!path.startsWith(id+"/")||path.includes(".."))return fail(res,409,"private_document_required");
  const {data:items,error:listErr}=await ctx.supabase.storage.from("contractor-docs").list(id,{search:path.split("/").pop()});
  if(listErr||!(items||[]).some(o=>o.name===path.split("/").pop()))return fail(res,409,"source_document_not_found");
  const {error}=await ctx.supabase.from("operations_credential_checks").insert({contractor_id:id,credential_kind:"insurance",method,result:"human_attested",document_path:path,source_reference:ref,checked_by:ctx.user.id,checked_by_label:ctx.user.email||"SSP Operations",evidence:{contact,notes,confirmed_active_by_human:true,notice:"Recorded human phone/portal confirmation, not an insurer-platform API response."}});
  if(error)return fail(res,500,"insurance_evidence_save_failed");
  return res.status(200).json({ok:true,status:"human_attested",notice:"Only the stated employee attestation is recorded; SSP did not contact the insurer."});
 }
 return fail(res,400,"invalid_action");
};
