// api/admin-dispute-decision.js — admin approve/reject of a lead-fee dispute.
const { requireAdmin } = require("./_admin-auth");
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports=async function handler(req,res){
  res.setHeader("Content-Type","application/json");
  if(req.method==="OPTIONS"){
    res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Authorization, Content-Type");
    return res.status(204).end();
  }
  if(req.method!=="POST") return res.status(405).json({ok:false,error:"method_not_allowed"});
  let ctx;try{ctx=await requireAdmin(req)}catch(e){return res.status(e.status||500).json({ok:false,error:e.message||"admin_auth_failed"})}
  const b=req.body||{};
  const disputeId=String(b.dispute_id||"").trim();
  const decision=String(b.decision||"").trim().toLowerCase();
  if(!UUID_RE.test(disputeId)) return res.status(400).json({ok:false,error:"invalid_dispute_id"});
  if(!["approved","rejected"].includes(decision)) return res.status(400).json({ok:false,error:"invalid_decision"});

  const {data,error}=await ctx.supabase.rpc("decide_lead_dispute",{
    p_dispute_id:disputeId,
    p_decision:decision,
    p_decided_by:ctx.user.email||ctx.user.id,
  });
  if(error){
    console.error("admin-dispute-decision:",error);
    return res.status(500).json({ok:false,error:"decision_failed"});
  }
  return res.status(200).json({ok:true,result:data});
};