"use strict";
const SOURCE="https://data.texas.gov/resource/7358-krk7.json";
const DATASET="https://data.texas.gov/dataset/TDLR-All-Licenses/7358-krk7";
const METADATA="https://data.texas.gov/api/views/7358-krk7.json";
function normalizeName(s){return String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z0-9]+/g," ").replace(/\b(LLC|INC|CORP|CORPORATION|CO|COMPANY|LTD|THE|LP|PLLC)\b/g," ").replace(/\s+/g," ").trim();}
function candidates(input) {
 const raw=String(input||"").trim().toUpperCase();
 if(!raw||raw.length>40||!/^[A-Z0-9\s./-]+$/.test(raw))return [];
 const compact=raw.replace(/[\s./-]/g,"");
 const digits=(compact.match(/\d{3,10}/)||[])[0]||"";
 const opts=[compact,raw.replace(/\s/g,""),digits,digits.replace(/^0+/,"")].filter(x=>x.length>=3&&x.length<=40);
 return [...new Set(opts)].slice(0,4);
}
function parseTdlrDate(value){
 const str=String(value||"").replace(/[^0-9]/g,"");
 if(str.length!==8)return null;
 const candidates=[{m:Number(str.slice(0,2)),d:Number(str.slice(2,4)),y:Number(str.slice(4,8))},{y:Number(str.slice(0,4)),m:Number(str.slice(4,6)),d:Number(str.slice(6,8))}];
 for(const {m,d,y} of candidates){if(y<1900||y>2120)continue;const dt=new Date(Date.UTC(y,m-1,d));if(dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d)return dt.toISOString().slice(0,10);}
 return null;
}
async function timedJson(url,fetcher,limit=12000){
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),limit);
 try{
  const r=await fetcher(url,{headers:{"Accept":"application/json"},signal:c.signal,cache:"no-store"});
  if(!r.ok)throw Error("official_registry_http_"+r.status);
  return await r.json();
 }finally{clearTimeout(timer);}
}
function evaluate(rows,numbers,expectedNames,asof){
 const today=new Date().toISOString().slice(0,10);
 const comparisons=rows.slice(0,20).map(row=>{
  const foundNumber=String(row.license_number||"").toUpperCase().replace(/[\s./-]/g,"");
  const numberMatch=numbers.includes(foundNumber)||(foundNumber.replace(/^0+/,"")&&numbers.includes(foundNumber.replace(/^0+/,"")));
  const officialNames=[row.business_name,row.owner_name].map(normalizeName).filter(Boolean);
  const names=expectedNames.map(normalizeName).filter(Boolean);
  const nameMatch=names.length?officialNames.some(v=>names.some(n=>n===v)):null;
  const type=String(row.license_type||"");
  const hvac=/AIR\s*COND|REFRIG|ACR|HVAC/i.test(type);
  const expiration=parseTdlrDate(row.license_expiration_date_mmddccyy);
  const expired=expiration?expiration<today:null;
  return {license_type:type,license_number:String(row.license_number||""),business_name:String(row.business_name||""),owner_name:String(row.owner_name||""),business_city_state_zip:String(row.business_city_state_zip||""),expiration_date:expiration,number_match:numberMatch,name_match:nameMatch,trade_is_acr:hvac,expired,source_asof:asof};
 });
 const matching=comparisons.filter(x=>x.number_match);
 const preferred=matching.find(x=>x.trade_is_acr&&!x.expired&&x.name_match)||matching.find(x=>x.trade_is_acr&&!x.expired)||matching[0]||null;
 let status="not_found";
 if(preferred){
  if(preferred.expired===true)status="expired_in_published_dataset";
  else if(!preferred.trade_is_acr)status="license_type_requires_review";
  else if(preferred.name_match===false)status="business_name_mismatch";
  else if(!preferred.expiration_date)status="expiration_unconfirmed";
  else status="corroborated_in_published_dataset";
 }
 return {status,matched:!!preferred,record:preferred,record_count:comparisons.length,official_candidates:comparisons.slice(0,6),source_url:DATASET,source_dataset_id:"7358-krk7",source_asof:asof,verification_level:"official_dataset_cross_check_only_not_live_status",needs_human_active_status_confirmation:true};
}
async function lookupTdlrLicense({licenseNumber,companyName,ownerName,fetcher=fetch}={}){
 const nums=candidates(licenseNumber);
 if(!nums.length)return {status:"invalid_number",matched:false,verification_level:"not_verified",source_url:DATASET,needs_human_active_status_confirmation:true};
 const source=new URL(SOURCE);
 source.searchParams.set("$where","license_number in ("+nums.map(n=>"'"+n.replace(/'/g,"")+"'" ).join(",")+")");
 source.searchParams.set("$limit","20");
 try{
  const rows=await timedJson(source.toString(),fetcher);
  if(!Array.isArray(rows))throw Error("unexpected_registry_response");
  let asof=null;
  try{
   const meta=await timedJson(METADATA,fetcher,9000);
   if(meta.rowsUpdatedAt){asof=new Date(Number(meta.rowsUpdatedAt)*1000).toISOString().slice(0,10);}
  }catch(_){}
  const result=evaluate(rows,nums,[companyName,ownerName],asof);
  result.checked_at=new Date().toISOString();
  return result;
 }catch(e){
  return {status:"source_unavailable",matched:false,source_url:DATASET,source_asof:null,checked_at:new Date().toISOString(),verification_level:"not_verified",needs_human_active_status_confirmation:true,error_code:/abort/i.test(String(e?.message||e))?"registry_timeout":"official_data_unavailable"};
 }
}
async function smokeTdlr(fetcher=fetch){
 try{
  const u=new URL(SOURCE);u.searchParams.set("$limit","1");u.searchParams.set("$select","license_number,license_type,business_name");
  const rows=await timedJson(u.toString(),fetcher);
  if(!Array.isArray(rows)||!rows.length||!rows[0].license_number)return {ok:false,error:"registry_sample_missing"};
  const result=await lookupTdlrLicense({licenseNumber:rows[0].license_number,companyName:rows[0].business_name,fetcher});
  return {ok:result.matched,source:DATASET,lookup_status:result.status,source_asof:result.source_asof,match:result.matched};
 }catch(e){return {ok:false,error:"registry_unavailable",source:DATASET};}
}
module.exports={lookupTdlrLicense,smokeTdlr,normalizeName,candidates,parseTdlrDate,evaluate,SOURCE,DATASET};
