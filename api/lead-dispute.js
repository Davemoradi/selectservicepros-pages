// api/lead-dispute.js — contractor files a dispute against an accepted lead fee.
// Identity and the debit transaction are derived server-side; the browser never
// chooses a wallet transaction to reverse.

const { createClient } = require("@supabase/supabase-js");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://kasqtxwbsmjlisbnebku.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = new Set(["invalid_contact","never_requested","out_of_area","duplicate","already_completed","cap_exceeded"]);
const DISPUTE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

module.exports = async function handler(req,res){
  res.setHeader("Content-Type","application/json");
  if(req.method==="OPTIONS"){
    res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Authorization, Content-Type");
    return res.status(204).end();
  }
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"method_not_allowed"});
  if(!SUPABASE_SERVICE_KEY) return res.status(500).json({ok:false,error:"server_misconfigured"});

  const h=req.headers.authorization||req.headers.Authorization||"";
  const token=h.startsWith("Bearer ")?h.slice(7).trim():"";
  if(!token) return res.status(401).json({ok:false,error:"missing_token"});

  const body=req.body||{};
  const leadId=String(body.lead_id||body.leadId||"").trim();
  const reason=String(body.reason||"").trim();
  const evidence=String(body.evidence||"").trim().slice(0,2000) || null;
  if(!UUID_RE.test(leadId)) return res.status(400).json({ok:false,error:"invalid_lead_id"});
  if(!REASONS.has(reason)) return res.status(400).json({ok:false,error:"invalid_reason"});

  const supabase=createClient(SUPABASE_URL,SUPABASE_SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:authData,error:authErr}=await supabase.auth.getUser(token);
  const user=authData&&authData.user;
  if(authErr||!user) return res.status(401).json({ok:false,error:"invalid_token"});

  const {data:contractor,error:cErr}=await supabase.from("contractors")
    .select("id").eq("auth_id",user.id).single();
  if(cErr||!contractor) return res.status(403).json({ok:false,error:"not_a_contractor"});

  const {data:offer,error:oErr}=await supabase.from("lead_offers")
    .select("transaction_id,responded_at,status")
    .eq("lead_id",leadId).eq("contractor_id",contractor.id).eq("status","accepted").single();
  if(oErr||!offer||!offer.transaction_id) return res.status(403).json({ok:false,error:"no_accepted_charge"});

  const acceptedAt=offer.responded_at?new Date(offer.responded_at).getTime():NaN;
  if(!Number.isFinite(acceptedAt) || Date.now()-acceptedAt>DISPUTE_WINDOW_MS){
    return res.status(409).json({ok:false,error:"dispute_window_closed",message:"The 7-day dispute window has closed."});
  }

  const {data:existing}=await supabase.from("lead_disputes")
    .select("id,decision,submitted_at").eq("debit_transaction_id",offer.transaction_id).maybeSingle();
  if(existing){
    return res.status(409).json({ok:false,error:"dispute_already_filed",dispute:existing,message:"A dispute has already been filed for this lead."});
  }

  const {data:dispute,error:dErr}=await supabase.from("lead_disputes").insert({
    debit_transaction_id:offer.transaction_id,
    lead_id:leadId,
    contractor_id:contractor.id,
    reason,
    evidence,
  }).select("id,submitted_at,decision").single();

  if(dErr){
    if(dErr.code==="23505") return res.status(409).json({ok:false,error:"dispute_already_filed"});
    console.error("lead-dispute: insert failed",dErr);
    return res.status(500).json({ok:false,error:"dispute_create_failed"});
  }

  return res.status(201).json({ok:true,dispute});
};