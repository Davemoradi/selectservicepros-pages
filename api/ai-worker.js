"use strict";
const crypto = require("node:crypto");
const { runOne } = require("../lib/ssp-ai-worker");
function authorized(header,secret) {
 if(!secret || typeof header!=="string" || !header.startsWith("Bearer "))return false;
 const token=header.slice(7).trim(), a=Buffer.from(token), b=Buffer.from(secret);
 return a.length===b.length && crypto.timingSafeEqual(a,b);
}
module.exports = async function handler(req,res){
 res.setHeader("Cache-Control","no-store");
 res.setHeader("Content-Type","application/json");
 if(req.method!=="POST")return res.status(405).json({ok:false,error:"method_not_allowed"});
 if(!authorized(req.headers.authorization,process.env.SSP_AI_WORKER_SECRET))return res.status(401).json({ok:false,error:"unauthorized"});
 if(!process.env.ANTHROPIC_API_KEY)return res.status(503).json({ok:false,error:"ai_model_not_configured"});
 const action=String((req.body||{}).action||"process");
 if(action==="smoke"){
  const model=process.env.SSP_AI_MODEL||"claude-sonnet-4-6";
  try{
   const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),25000);
   let response;
   try{response=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":process.env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01","content-type":"application/json"},body:JSON.stringify({model,max_tokens:40,messages:[{role:"user",content:"Reply with exactly READY."}]}),signal:ac.signal});}finally{clearTimeout(timer)}
   const data=await response.json().catch(()=>({}));
   return response.ok?res.status(200).json({ok:true,model:data.model||model,service:"reachable"}):res.status(503).json({ok:false,error:"model_http_"+response.status});
  }catch(e){return res.status(503).json({ok:false,error:"model_smoke_failed"})}
 }
 if(action!=="process")return res.status(400).json({ok:false,error:"invalid_action"});
 try{
  const result=await runOne();
  return res.status(result.ok?200:202).json(result);
 }catch(e){
  console.error("SSP AI worker failure",String(e&&e.message||"unknown").slice(0,150));
  return res.status(500).json({ok:false,error:"worker_unavailable"});
 }
};
module.exports.authorized = authorized;
