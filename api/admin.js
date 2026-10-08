// Consolidated SSP admin API. Kept as one Vercel Function to stay within
// Hobby-plan function limits while preserving server-side admin auth.
const { requireAdmin } = require("../lib/admin-auth");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_STATUSES = new Set(["Suspended","Pending Profile","Pending Review","Rejected","Deletion Requested"]);
const DOC_BUCKET = "contractor-docs";

function fail(res, status, error, extra) {
  return res.status(status).json(Object.assign({ ok:false, error }, extra || {}));
}

async function getData(ctx, res) {
  const { supabase, user } = ctx;
  try {
    const [contractorsR, licensesR, leadsR, offersR, walletR, pricingR, disputesR] = await Promise.all([
      supabase.from("contractors")
        .select("id,email,first_name,last_name,company_name,phone,status,service_categories,service_zips,promo_credits_cents,lead_balance_cents,insurance_verified,insurance_expiration,insurance_doc_url,insurance_carrier,insurance_policy_number,website_url,num_technicians,num_vehicles,scheduling_system,agreement_accepted_at,created_at")
        .order("created_at", { ascending:false }),
      supabase.from("contractor_licenses")
        .select("id,contractor_id,trade_category,license_type,license_state,license_number,expiration_date,document_url,verified,verified_at")
        .order("created_at", { ascending:false }),
      supabase.from("leads")
        .select("id,created_at,homeowner_name,homeowner_phone,homeowner_email,homeowner_zip,service_category,service_type,issue_code,urgency,status,pricing_version,pricing_band,price_cents,matching_expires_at")
        .order("created_at", { ascending:false }).limit(250),
      supabase.from("lead_offers")
        .select("id,lead_id,contractor_id,status,price_cents,offered_at,expires_at,responded_at,transaction_id")
        .order("offered_at", { ascending:false }).limit(1000),
      supabase.from("wallet_transactions")
        .select("id,contractor_id,type,amount_cents,promo_delta_cents,paid_delta_cents,lead_id,description,created_by,idempotency_key,created_at")
        .order("created_at", { ascending:false }).limit(2000),
      supabase.from("band_map")
        .select("version,category,issue_code,label,band,price_cents,requires_clarification")
        .eq("version","v1").order("category", { ascending:true }),
      supabase.from("lead_disputes")
        .select("id,contractor_id,lead_id,debit_transaction_id,reason,evidence,submitted_at,decided_at,decision,decided_by,restored_promo_cents,restored_paid_cents,reversal_transaction_id")
        .order("submitted_at", { ascending:false }).limit(250),
    ]);

    for (const [name, r] of Object.entries({contractorsR,licensesR,leadsR,offersR,walletR,pricingR})) {
      if (r.error) throw new Error(`${name}:${r.error.message}`);
    }

    const disputes = disputesR.error ? [] : (disputesR.data || []);
    const [notesR, notificationsR, profilesR, auditR] = await Promise.all([
      supabase.from("contractor_admin_notes").select("id,contractor_id,body,created_at,created_by").order("created_at",{ascending:false}).limit(500),
      supabase.from("notification_outbox").select("id,contractor_id,lead_id,event_type,status,attempt_count,sent_at,last_error,created_at").order("created_at",{ascending:false}).limit(500),
      supabase.from("contractor_admin_profiles").select("*").limit(1000),
      supabase.from("contractor_admin_audit").select("id,contractor_id,actor_email,action,changes,created_at").order("created_at",{ascending:false}).limit(1000)
    ]);
    if(notesR.error || notificationsR.error || profilesR.error || auditR.error) throw new Error("operations_history_unavailable");
    const contractors = contractorsR.data || [];
    const licenses = licensesR.data || [];
    const leads = leadsR.data || [];
    const offers = offersR.data || [];
    const wallet = walletR.data || [];
    const pricing = pricingR.data || [];

    const licenseByContractor = new Map();
    for (const l of licenses) {
      if (!licenseByContractor.has(l.contractor_id)) licenseByContractor.set(l.contractor_id, []);
      licenseByContractor.get(l.contractor_id).push(l);
    }

    const contractorsOut = contractors.map((c) => ({
      ...c,
      licenses: licenseByContractor.get(c.id) || [],
    }));

    const acceptedOffers = offers.filter((o) => o.status === "accepted");
    const leadCharges = wallet.filter((t) => t.type === "lead_charge");
    const topups = wallet.filter((t) => t.type === "topup");
    const promoGrants = wallet.filter((t) => t.type === "promo_grant");
    const founding25Grants = promoGrants.filter((t) => String(t.idempotency_key || "").startsWith("founding25:v1:"));

    return res.status(200).json({
      ok: true,
      admin: { email: user.email || null },
      contractors: contractorsOut,
      leads,
      offers,
      wallet_transactions: wallet,
      pricing,
      disputes,
      notes: notesR.data || [],
      admin_profiles: profilesR.data || [],
      audit: auditR.data || [],
      notifications: notificationsR.data || [],
      stats: {
        contractors_total: contractors.length,
        contractors_active: contractors.filter((c) => c.status === "Active").length,
        contractors_pending_review: contractors.filter((c) => c.status === "Pending Review").length,
        leads_total_loaded: leads.length,
        leads_offering: leads.filter((l) => l.status === "Offering").length,
        leads_matched: leads.filter((l) => l.status === "Matched").length,
        leads_unmatched: leads.filter((l) => l.status === "Unmatched").length,
        accepted_offers: acceptedOffers.length,
        paid_wallet_cents: contractors.reduce((n,c) => n + Number(c.lead_balance_cents || 0), 0),
        promo_wallet_cents: contractors.reduce((n,c) => n + Number(c.promo_credits_cents || 0), 0),
        lead_charge_cents: leadCharges.reduce((n,t) => n + Math.abs(Number(t.amount_cents || 0)), 0),
        stripe_topup_cents: topups.reduce((n,t) => n + Math.max(0, Number(t.amount_cents || 0)), 0),
        promo_grant_cents: promoGrants.reduce((n,t) => n + Math.max(0, Number(t.amount_cents || 0)), 0),
        founding25_grants: founding25Grants.length,
        pricing_rows: pricing.length,
        pricing_held: pricing.filter((r) => r.requires_clarification).length,
        disputes_open: disputes.filter((d) => !d.decision).length,
      },
    });
  } catch (err) {
    console.error("admin data:", err && err.message);
    return fail(res, 500, "admin_data_failed");
  }
}

async function contractorAction(ctx, res, b) {
  const { supabase, user } = ctx;
  const action = String(b.action || "");
  const contractorId = String(b.contractor_id || "").trim();
  if (!UUID_RE.test(contractorId)) return fail(res, 400, "invalid_contractor_id");

  try {
    if (action === "set_status") {
      const status = String(b.status || "");
      if (!ALLOWED_STATUSES.has(status)) return fail(res, 400, "invalid_status");
      const { data, error } = await supabase.from("contractors")
        .update({ status }).eq("id", contractorId).select("id,status").single();
      if (error) throw error;
      return res.status(200).json({ ok:true, contractor:data });
    }

    if (action === "activate") {
      const { data, error } = await supabase.rpc("activate_contractor", { p_contractor_id: contractorId });
      if (error) {
        const msg = String(error.message || "");
        if (msg.includes("activation_not_ready:")) {
          return fail(res, 409, "activation_not_ready", { detail:msg.split("activation_not_ready:")[1] || "requirements_not_met" });
        }
        throw error;
      }
      return res.status(200).json({ ok:true, result:data });
    }

    if (action === "set_insurance_verified") {
      const verified = b.verified === true;
      const patch = {
        insurance_verified: verified,
        insurance_verified_at: verified ? new Date().toISOString() : null,
      };
      const { data, error } = await supabase.from("contractors")
        .update(patch).eq("id", contractorId).select("id,insurance_verified,insurance_verified_at").single();
      if (error) throw error;
      return res.status(200).json({ ok:true, contractor:data });
    }

    if (action === "set_license_verified") {
      const licenseId = String(b.license_id || "").trim();
      if (!UUID_RE.test(licenseId)) return fail(res, 400, "invalid_license_id");
      const verified = b.verified === true;
      const patch = {
        verified,
        verified_at: verified ? new Date().toISOString() : null,
        verified_by: verified ? (user.email || user.id) : null,
      };
      const { data, error } = await supabase.from("contractor_licenses")
        .update(patch).eq("id", licenseId).eq("contractor_id", contractorId)
        .select("id,contractor_id,verified,verified_at,verified_by").single();
      if (error) throw error;
      return res.status(200).json({ ok:true, license:data });
    }

    if (action === "approve_founding25") {
      const { data, error } = await supabase.rpc("approve_founding25_contractor", { p_contractor_id: contractorId });
      if (error) {
        const msg = String(error.message || "");
        if (msg.includes("founding25_full")) return fail(res, 409, "founding25_full");
        if (msg.includes("activation_not_ready:")) {
          return fail(res, 409, "activation_not_ready", { detail:msg.split("activation_not_ready:")[1] || "requirements_not_met" });
        }
        throw error;
      }
      return res.status(200).json({ ok:true, result:data });
    }

    if (action === "grant_founding25") {
      const { data, error } = await supabase.rpc("grant_founding25_promo", { p_contractor_id: contractorId });
      if (error) {
        if (String(error.message || "").includes("founding25_full")) return fail(res, 409, "founding25_full");
        throw error;
      }
      return res.status(200).json({ ok:true, transaction:data });
    }

    return fail(res, 400, "invalid_action");
  } catch (err) {
    console.error("admin contractor action:", action, err && err.message);
    return fail(res, 500, "admin_update_failed");
  }
}

async function documentUrl(ctx, res, b) {
  const contractorId = String(b.contractor_id || "").trim();
  const kind = String(b.kind || "").trim();
  if (!UUID_RE.test(contractorId)) return fail(res, 400, "invalid_contractor_id");
  if (!["insurance","license"].includes(kind)) return fail(res, 400, "invalid_kind");

  let objectPath = null;
  if (kind === "insurance") {
    const { data, error } = await ctx.supabase.from("contractors")
      .select("insurance_doc_url").eq("id", contractorId).single();
    if (error || !data) return fail(res, 404, "contractor_not_found");
    objectPath = data.insurance_doc_url || null;
  } else {
    const licenseId = String(b.license_id || "").trim();
    if (!UUID_RE.test(licenseId)) return fail(res, 400, "invalid_license_id");
    const { data, error } = await ctx.supabase.from("contractor_licenses")
      .select("document_url").eq("id", licenseId).eq("contractor_id", contractorId).single();
    if (error || !data) return fail(res, 404, "license_not_found");
    objectPath = data.document_url || null;
  }

  if (!objectPath) return fail(res, 404, "document_not_uploaded");
  if (/^https?:\/\//i.test(objectPath) || objectPath.includes("..")) {
    return fail(res, 409, "invalid_document_path");
  }

  const { data, error } = await ctx.supabase.storage.from(DOC_BUCKET).createSignedUrl(objectPath, 300);
  if (error || !data || !data.signedUrl) {
    console.error("admin document url:", error && error.message);
    return fail(res, 500, "signed_url_failed");
  }
  return res.status(200).json({ ok:true, url:data.signedUrl, expires_in:300 });
}

async function decideDispute(ctx, res, b) {
  const disputeId = String(b.dispute_id || "").trim();
  const decision = String(b.decision || "").trim().toLowerCase();
  if (!UUID_RE.test(disputeId)) return fail(res, 400, "invalid_dispute_id");
  if (!["approved","rejected"].includes(decision)) return fail(res, 400, "invalid_decision");

  const { data, error } = await ctx.supabase.rpc("decide_lead_dispute", {
    p_dispute_id: disputeId,
    p_decision: decision,
    p_decided_by: ctx.user.email || ctx.user.id,
  });
  if (error) {
    console.error("admin dispute decision:", error && error.message);
    return fail(res, 500, "decision_failed");
  }
  return res.status(200).json({ ok:true, result:data });
}

async function addContractorNote(ctx,res,b){
 const contractorId=String(b.contractor_id||"").trim();
 const body=String(b.body||"").trim();
 if(!UUID_RE.test(contractorId)||!body||body.length>5000)return fail(res,400,"invalid_note");
 const {data:contractor,error:lookupErr}=await ctx.supabase.from("contractors").select("id").eq("id",contractorId).maybeSingle();
 if(lookupErr||!contractor)return fail(res,404,"contractor_not_found");
 const {data,error}=await ctx.supabase.from("contractor_admin_notes").insert({contractor_id:contractorId,body,created_by:ctx.user.id}).select("id,contractor_id,body,created_at").single();
 if(error){console.error("admin note insert",error.message);return fail(res,500,"note_save_failed");}
 return res.status(200).json({ok:true,note:data});
}

async function saveProfile(ctx,res,b){
 const id=String(b.contractor_id||""); if(!UUID_RE.test(id))return fail(res,400,"invalid_contractor");
 const editable=["company_name","first_name","last_name","phone","website_url","business_description","service_categories","service_zips","scheduling_system","phone_answered_by"];
 const external=["google_business_url","google_reviews_url","google_rating","google_review_count","yelp_url","yelp_rating","yelp_review_count","trustpilot_url","trustpilot_rating","trustpilot_review_count"];
 const incoming=b.fields||{};const fields={};const ext={};
 for(const [key,val] of Object.entries(incoming)){
  if(!editable.includes(key)&&!external.includes(key))return fail(res,400,"invalid_field");
  if(val!==null&&typeof val!=="string"&&typeof val!=="number")return fail(res,400,"invalid_value");
  if(typeof val==="string"&&val.length>2000)return fail(res,400,"value_too_long");
  if(key.endsWith("_url")&&val){try{const u=new URL(val);if(!["https:","http:"].includes(u.protocol))return fail(res,400,"invalid_url")}catch{return fail(res,400,"invalid_url")}}
  if(key.endsWith("_rating")&&val!==null&&val!==""){if(!Number.isFinite(Number(val))||Number(val)<0||Number(val)>5)return fail(res,400,"invalid_rating")}
  if(key.endsWith("_review_count")&&val!==null&&val!==""){if(!Number.isInteger(Number(val))||Number(val)<0)return fail(res,400,"invalid_review_count")}
  const value=key.endsWith("_rating")||key.endsWith("_review_count")?(val===""?null:val):val;
  if(editable.includes(key))fields[key]=value;else ext[key]=value;
 }
 const custom=b.custom_fields;
 if(custom!==undefined){if(!custom||Array.isArray(custom)||typeof custom!=="object"||Object.keys(custom).length>30||Object.entries(custom).some(([k,v])=>k.length>80||typeof v!=="string"||v.length>1000))return fail(res,400,"invalid_custom_fields");ext.custom_fields=custom}
 if(!Object.keys(fields).length&&!Object.keys(ext).length)return fail(res,400,"empty_update");
 const {data:prior,error:priorErr}=await ctx.supabase.from("contractors").select("id,"+editable.join(",")).eq("id",id).maybeSingle();if(priorErr||!prior)return fail(res,404,"contractor_not_found");
 const {data:oldExt}=await ctx.supabase.from("contractor_admin_profiles").select("*").eq("contractor_id",id).maybeSingle();
 const changes={};for(const [k,v] of Object.entries({...fields,...ext})){const old=(k in fields?prior:oldExt||{})[k]??null;if(JSON.stringify(old)!==JSON.stringify(v))changes[k]={before:old,after:v}}
 if(!Object.keys(changes).length)return res.status(200).json({ok:true,unchanged:true});
 if(Object.keys(fields).length){const {error}=await ctx.supabase.from("contractors").update(fields).eq("id",id);if(error)return fail(res,500,"profile_update_failed")}
 if(Object.keys(ext).length){const {error}=await ctx.supabase.from("contractor_admin_profiles").upsert({contractor_id:id,...ext,updated_by:ctx.user.id,updated_at:new Date().toISOString()});if(error)return fail(res,500,"external_profile_update_failed")}
 const {error:auditErr}=await ctx.supabase.from("contractor_admin_audit").insert({contractor_id:id,actor_id:ctx.user.id,actor_email:ctx.user.email||"",action:"profile_updated",changes});if(auditErr){console.error("audit failed",auditErr.message);return fail(res,500,"audit_save_failed")}
 return res.status(200).json({ok:true});
}
module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    return res.status(204).end();
  }

  if (!["GET","POST"].includes(req.method)) {
    return fail(res, 405, "method_not_allowed");
  }

  let ctx;
  try {
    ctx = await requireAdmin(req);
  } catch (e) {
    return fail(res, e.status || 500, e.message || "admin_auth_failed");
  }

  if (req.method === "GET") {
    const action = String((req.query && req.query.action) || "data");
    if (action !== "data") return fail(res, 400, "invalid_action");
    return getData(ctx, res);
  }

  const b = req.body || {};
  const action = String(b.action || "");

  if (["set_status","activate","set_insurance_verified","set_license_verified","approve_founding25","grant_founding25"].includes(action)) {
    return contractorAction(ctx, res, b);
  }
  if (action === "save_profile") return saveProfile(ctx,res,b);
  if (action === "add_contractor_note") return addContractorNote(ctx, res, b);
  if (action === "document_url") return documentUrl(ctx, res, b);
  if (action === "decide_dispute") return decideDispute(ctx, res, b);

  return fail(res, 400, "invalid_action");
};
