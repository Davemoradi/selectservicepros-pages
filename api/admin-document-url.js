// api/admin-document-url.js — short-lived signed URL for contractor evidence.
// Admin auth is verified server-side; storage remains private.
const { requireAdmin } = require("./_admin-auth");
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET="contractor-docs";

module.exports=async function handler(req,res){
  res.setHeader("Content-Type","application/json");
  res.setHeader("Cache-Control","no-store");
  if(req.method==="OPTIONS"){
    res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Authorization, Content-Type");
    return res.status(204).end();
  }
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"method_not_allowed"});

  let ctx;try{ctx=await requireAdmin(req)}catch(e){return res.status(e.status||500).json({ok:false,error:e.message||"admin_auth_failed"})}
  const b=req.body||{};
  const contractorId=String(b.contractor_id||"").trim();
  const kind=String(b.kind||"").trim();
  if(!UUID_RE.test(contractorId)) return res.status(400).json({ok:false,error:"invalid_contractor_id"});
  if(!["insurance","license"].includes(kind)) return res.status(400).json({ok:false,error:"invalid_kind"});

  let objectPath=null;
  if(kind==="insurance"){
    const {data,error}=await ctx.supabase.from("contractors").select("insurance_doc_url").eq("id",contractorId).single();
    if(error||!data) return res.status(404).json({ok:false,error:"contractor_not_found"});
    objectPath=data.insurance_doc_url||null;
  }else{
    const licenseId=String(b.license_id||"").trim();
    if(!UUID_RE.test(licenseId)) return res.status(400).json({ok:false,error:"invalid_license_id"});
    const {data,error}=await ctx.supabase.from("contractor_licenses")
      .select("document_url").eq("id",licenseId).eq("contractor_id",contractorId).single();
    if(error||!data) return res.status(404).json({ok:false,error:"license_not_found"});
    objectPath=data.document_url||null;
  }

  if(!objectPath) return res.status(404).json({ok:false,error:"document_not_uploaded"});
  // DB stores a bucket-relative private object path, never a public URL.
  if(/^https?:\/\//i.test(objectPath)||objectPath.includes("..")) return res.status(409).json({ok:false,error:"invalid_document_path"});

  const {data,error}=await ctx.supabase.storage.from(BUCKET).createSignedUrl(objectPath,300);
  if(error||!data?.signedUrl){
    console.error("admin-document-url:",error);
    return res.status(500).json({ok:false,error:"signed_url_failed"});
  }
  return res.status(200).json({ok:true,url:data.signedUrl,expires_in:300});
};