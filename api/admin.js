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
  if(ctx.isStaffOnly){
    try{
      const [tasks,notes,files,events,staff,contractors,alertReads,aiReviews]=await Promise.all([
        supabase.from("operations_tasks").select("*").order("created_at",{ascending:false}).limit(1000),
        supabase.from("operations_task_notes").select("id,task_id,body,author_email,created_at").order("created_at",{ascending:false}).limit(2000),
        supabase.from("operations_task_attachments").select("id,task_id,file_name,size_bytes,uploader_email,created_at").order("created_at",{ascending:false}).limit(2000),
        supabase.from("operations_task_events").select("id,task_id,actor_email,event_type,created_at").order("created_at",{ascending:false}).limit(1000),
        supabase.from("operations_staff").select("id,name,email,active,role,employment_status").eq("active",true),
        supabase.from("contractors").select("id,contractor_number,company_name").limit(1000),
        supabase.from("operations_alert_reads").select("alert_key,read_at").eq("user_id",user.id).limit(3000),
        supabase.from("operations_ai_reviews").select("id,task_id,status,phase,requested_at,completed_at,model_name,summary,proposed_action,agent_findings,evidence,verification_summary,error_code,reviewed_at").order("requested_at",{ascending:false}).limit(1000)
      ]);
      if([tasks,notes,files,events,staff,contractors,alertReads,aiReviews].some(x=>x.error))return fail(res,500,"work_queue_unavailable");
      return res.status(200).json({ok:true,admin:{email:user.email,staff_only:true},tasks:tasks.data||[],task_notes:notes.data||[],task_files:files.data||[],task_events:events.data||[],staff:staff.data||[],contractors:contractors.data||[],alert_reads:alertReads.data||[],ai_reviews:aiReviews.data||[]});
    }catch(e){return fail(res,500,"work_queue_unavailable")}
  }
  try {
    const [contractorsR, licensesR, leadsR, offersR, walletR, pricingR, disputesR] = await Promise.all([
      supabase.from("contractors")
        .select("id,contractor_number,email,first_name,last_name,company_name,phone,status,service_categories,service_zips,promo_credits_cents,lead_balance_cents,insurance_verified,insurance_expiration,insurance_doc_url,insurance_carrier,insurance_policy_number,website_url,num_technicians,num_vehicles,scheduling_system,agreement_accepted_at,created_at")
        .order("created_at", { ascending:false }),
      supabase.from("contractor_licenses")
        .select("id,contractor_id,trade_category,license_type,license_state,license_number,expiration_date,document_url,verified,verified_at")
        .order("created_at", { ascending:false }),
      supabase.from("leads")
        .select("id,created_at,homeowner_name,homeowner_phone,homeowner_email,homeowner_zip,homeowner_city,homeowner_state,service_category,service_type,issue_code,urgency,status,assigned_contractor_id,partial,paid,accepted_at,pricing_version,pricing_band,price_cents,matching_expires_at")
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
    const [notesR, notificationsR, profilesR, auditR, tasksR, taskEventsR, taskNotesR, taskFilesR, staffR, alertReadsR, aiReviewsR, leadTriageR, leadEventsR, pilotsR, pilotEventsR] = await Promise.all([
      supabase.from("contractor_admin_notes").select("id,contractor_id,body,created_at,created_by,author_email").order("created_at",{ascending:false}).limit(500),
      supabase.from("notification_outbox").select("id,contractor_id,lead_id,event_type,status,attempt_count,sent_at,last_error,created_at").order("created_at",{ascending:false}).limit(500),
      supabase.from("contractor_admin_profiles").select("*").limit(1000),
      supabase.from("contractor_admin_audit").select("id,contractor_id,actor_email,action,changes,created_at").order("created_at",{ascending:false}).limit(1000),
      supabase.from("operations_tasks").select("*").order("created_at",{ascending:false}).limit(1000),
      supabase.from("operations_task_events").select("id,task_id,actor_email,event_type,created_at").order("created_at",{ascending:false}).limit(1000),
      supabase.from("operations_task_notes").select("id,task_id,body,author_email,created_at").order("created_at",{ascending:false}).limit(2000),
      supabase.from("operations_task_attachments").select("id,task_id,file_name,size_bytes,uploader_email,created_at").order("created_at",{ascending:false}).limit(2000),
      supabase.from("operations_staff").select("id,email,name,first_name,last_name,active,employment_status,role,created_at").order("name"),
      supabase.from("operations_alert_reads").select("alert_key,read_at").eq("user_id",user.id).limit(3000),
      supabase.from("operations_ai_reviews").select("id,task_id,status,requested_at,completed_at,model_name,summary,proposed_action,agent_findings,evidence,verification_summary,error_code,reviewed_at").order("requested_at",{ascending:false}).limit(1000),
      supabase.from("operations_lead_triage").select("lead_id,workflow_status,assigned_to,follow_up_at,reason,updated_by_email,updated_at").limit(2000),
      supabase.from("operations_lead_events").select("id,lead_id,actor_email,action,before_state,after_state,created_at").order("created_at",{ascending:false}).limit(2000),
      supabase.from("operations_hvac_pilot_authorizations").select("contractor_id,insurance_review_id,approved_by_email,approved_at,approved_until,reason,revoked_at,revoked_by_email,revocation_reason").limit(1000),
      supabase.from("operations_hvac_pilot_events").select("id,contractor_id,actor_email,action,created_at,after_state").order("created_at",{ascending:false}).limit(1000)
    ]);
    if(notesR.error || notificationsR.error || profilesR.error || auditR.error || tasksR.error || taskEventsR.error || taskNotesR.error || taskFilesR.error || staffR.error || alertReadsR.error || aiReviewsR.error || leadTriageR.error || leadEventsR.error || pilotsR.error || pilotEventsR.error) throw new Error("operations_history_unavailable");
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
      tasks: tasksR.data || [],
      task_events: taskEventsR.data || [],
      task_notes: taskNotesR.data || [],
      task_files: taskFilesR.data || [],
      staff: staffR.data || [],
      alert_reads: alertReadsR.data || [],
      ai_reviews: aiReviewsR.data || [],
      lead_triage: leadTriageR.data || [],
      lead_events: leadEventsR.data || [],
      hvac_pilots: pilotsR.data || [],
      hvac_pilot_events: pilotEventsR.data || [],
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

async function hvacPilotAction(ctx,res,b){
 if(!ctx.isOwner)return fail(res,403,"owner_required");
 const contractor_id=String(b.contractor_id||"");
 if(!UUID_RE.test(contractor_id))return fail(res,400,"invalid_contractor_id");
 const action=String(b.action||"");
 if(action==="check_hvac_pilot"){
  const [ready,valid,activation]=await Promise.all([
   ctx.supabase.rpc("ssp_hvac_pilot_prerequisites",{p_contractor_id:contractor_id}),
   ctx.supabase.rpc("ssp_hvac_pilot_authorization_valid",{p_contractor_id:contractor_id}),
   ctx.supabase.rpc("contractor_activation_readiness",{p_contractor_id:contractor_id})
  ]);
  if(ready.error||valid.error||activation.error)return fail(res,500,"pilot_readiness_unavailable");
  return res.status(200).json({ok:true,prerequisites:ready.data,pilot_leads_enabled:valid.data===true,activation_readiness:activation.data});
 }
 if(!["approve_hvac_pilot","revoke_hvac_pilot"].includes(action))return fail(res,400,"invalid_action");
 const approving=action==="approve_hvac_pilot";
 const reason=String(b.reason||"").trim();
 const days=approving?Number(b.days):30;
 if(reason.length<25||reason.length>2000||(approving&&(!Number.isInteger(days)||days<1||days>60)))return fail(res,400,"pilot_reason_or_duration_invalid");
 if(approving&&b.acknowledge_unverified!==true)return fail(res,400,"unverified_coverage_acknowledgement_required");
 const {data,error}=await ctx.supabase.rpc("ssp_hvac_pilot_decision",{
  p_contractor_id:contractor_id,p_action:approving?"Approve":"Revoke",
  p_actor_id:ctx.user.id,p_actor_email:ctx.user.email||"SSP Operations",
  p_reason:reason,p_days:days
 });
 if(error){
  const msg=String(error.message||"");
  if(/pilot_not_ready:|pilot_duration_invalid|pilot_limit_reached|pilot_not_active|detailed_reason_required|contractor_not_found/.test(msg))
   return fail(res,409,"pilot_decision_blocked",{detail:msg.slice(0,180)});
  console.error("pilot auth operation error",msg.slice(0,170));
  return fail(res,500,"pilot_decision_failed");
 }
 return res.status(200).json(data);
}

async function updateLeadTriage(ctx,res,b){
 const lead_id=String(b.lead_id||"");
 const status=String(b.workflow_status||"");
 const reason=String(b.reason||"").trim();
 const assigned=String(b.assigned_to||"").trim().toLowerCase();
 const date=b.follow_up_at?new Date(b.follow_up_at):null;
 if(!UUID_RE.test(lead_id)||!["Needs Review","Follow Up","Ready","On Hold","Closed"].includes(status)||reason.length<12||reason.length>2000||assigned.length>160||(date&&Number.isNaN(date.getTime())))return fail(res,400,"invalid_lead_triage");
 const {data,error}=await ctx.supabase.rpc("ssp_update_lead_triage",{
  p_lead_id:lead_id,p_workflow_status:status,p_assigned_to:assigned||null,
  p_follow_up_at:date?date.toISOString():null,p_reason:reason,
  p_actor_id:ctx.user.id,p_actor_email:ctx.user.email||"SSP Operations"
 });
 if(error){const msg=String(error.message||"");if(/active_employee_required|reason_required|lead_not_found|invalid_workflow_status/.test(msg))return fail(res,409,msg.slice(0,120));return fail(res,500,"lead_triage_update_failed")}
 return res.status(200).json(data);
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
 const {data,error}=await ctx.supabase.from("contractor_admin_notes").insert({contractor_id:contractorId,body,created_by:ctx.user.id,author_email:ctx.user.email||""}).select("id,contractor_id,body,created_at").single();
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

async function taskAction(ctx,res,b){
 const {supabase,user}=ctx;
 const action=String(b.action||"");
 if(action==="create_task"){
  const title=String(b.title||"").trim(),details=String(b.details||"").trim(),priority=String(b.priority||"Normal");
  const assigned_to=String(b.assigned_to||"").trim().toLowerCase()||null;
  if(assigned_to){const {data:staff}=await supabase.from("operations_staff").select("id").eq("email",assigned_to).eq("active",true).maybeSingle();if(!staff)return fail(res,400,"assignee_not_employee")}
  const contractor_id=b.contractor_id||null;
  if(title.length<3||title.length>180||details.length>3000||!["Low","Normal","High","Urgent"].includes(priority)||contractor_id&&!UUID_RE.test(contractor_id))return fail(res,400,"invalid_task");
  let due_at=null;
  if(b.due_at){const parsed=new Date(b.due_at);if(Number.isNaN(parsed.getTime()))return fail(res,400,"invalid_due_date");due_at=parsed.toISOString()}
  if(contractor_id){const {data}=await supabase.from("contractors").select("id").eq("id",contractor_id).maybeSingle();if(!data)return fail(res,404,"contractor_not_found")}
  const {data,error}=await supabase.from("operations_tasks").insert({title,details,priority,assigned_to,contractor_id,due_at,created_by:user.id,updated_by:user.id}).select("*").single();
  if(error)return fail(res,500,"task_create_failed");
  const {error:auditErr}=await supabase.from("operations_task_events").insert({task_id:data.id,actor_id:user.id,actor_email:user.email||"",event_type:"created",after_state:data});
  if(auditErr){console.error("task audit failure",auditErr.message);return fail(res,500,"task_audit_failed")}
  return res.status(200).json({ok:true,task:data});
 }
 if(action==="update_task"){
  const id=String(b.task_id||"");if(!UUID_RE.test(id))return fail(res,400,"invalid_task_change");
  const patch={};
  for(const [k,v] of Object.entries(b.fields||{})){
   if(!["title","details","status","priority","assigned_to","due_at","contractor_id"].includes(k))return fail(res,400,"invalid_task_field");
   if(k==="title"&&(typeof v!=="string"||v.trim().length<3||v.length>180))return fail(res,400,"invalid_title");
   if(k==="details"&&(typeof v!=="string"||v.length>3000))return fail(res,400,"invalid_details");
   if(k==="status"&&!["Open","In Progress","Done","Cancelled"].includes(v))return fail(res,400,"invalid_status");
   if(k==="priority"&&!["Low","Normal","High","Urgent"].includes(v))return fail(res,400,"invalid_priority");
   if(k==="assigned_to"&&v!==null&&(typeof v!=="string"||v.length>160))return fail(res,400,"invalid_assignee");
   if(k==="assigned_to"&&v){const {data:staff}=await supabase.from("operations_staff").select("id").eq("email",String(v).toLowerCase()).eq("active",true).maybeSingle();if(!staff)return fail(res,400,"assignee_not_employee");patch[k]=String(v).toLowerCase();continue;}
   if(k==="contractor_id"&&v!==null&&!UUID_RE.test(v))return fail(res,400,"invalid_contractor");
   if(k==="due_at"&&v!==null&&Number.isNaN(new Date(v).getTime()))return fail(res,400,"invalid_due");
   patch[k]=v;
  }
  if(!Object.keys(patch).length)return fail(res,400,"empty_update");
  const {data:before,error:readErr}=await supabase.from("operations_tasks").select("*").eq("id",id).maybeSingle();
  if(readErr||!before)return fail(res,404,"task_not_found");
  if(b.expected_updated_at&&b.expected_updated_at!==before.updated_at)return fail(res,409,"task_changed_refresh");
  const changes={};for(const [k,v] of Object.entries(patch))if(JSON.stringify(before[k]??null)!==JSON.stringify(v))changes[k]={before:before[k]??null,after:v};
  if(!Object.keys(changes).length)return res.status(200).json({ok:true,unchanged:true});
  const {data,error}=await supabase.from("operations_tasks").update({...patch,updated_by:user.id,updated_at:new Date().toISOString()}).eq("id",id).eq("updated_at",before.updated_at).select("*").maybeSingle();
  if(error)return fail(res,500,"task_update_failed");
  if(!data)return fail(res,409,"task_changed_refresh");
  const {error:auditErr}=await supabase.from("operations_task_events").insert({task_id:id,actor_id:user.id,actor_email:user.email||"",event_type:"edited",before_state:changes,after_state:data});
  if(auditErr){console.error("task audit failure",auditErr.message);return fail(res,500,"task_audit_failed")}
  return res.status(200).json({ok:true,task:data});
 }
 return fail(res,400,"invalid_task_action");
}


async function taskSupplement(ctx,res,b){
 const id=String(b.task_id||"");if(!UUID_RE.test(id))return fail(res,400,"invalid_task_id");
 const {data:task}=await ctx.supabase.from("operations_tasks").select("id").eq("id",id).maybeSingle();
 if(!task)return fail(res,404,"task_not_found");
 if(b.action==="add_task_note"){
  const body=String(b.body||"").trim();if(!body||body.length>5000)return fail(res,400,"invalid_note");
  const {data,error}=await ctx.supabase.from("operations_task_notes").insert({task_id:id,body,author_id:ctx.user.id,author_email:ctx.user.email||""}).select("*").single();
  if(error)return fail(res,500,"note_failed");return res.status(200).json({ok:true,note:data});
 }
 if(b.action==="init_task_upload"){
  const name=String(b.file_name||"").replace(/[\\/]/g,"_").slice(0,180);
  const type=String(b.content_type||"");const size=Number(b.size_bytes||0);
  if(!name||!["application/pdf","image/png","image/jpeg","image/webp","text/plain"].includes(type)||!Number.isInteger(size)||size<1||size>10485760)return fail(res,400,"invalid_attachment");
  const path=id+"/"+require("crypto").randomUUID()+"-"+name;
  const {data,error}=await ctx.supabase.storage.from("ssp-operations-files").createSignedUploadUrl(path);
  if(error||!data)return fail(res,500,"upload_url_failed");
  return res.status(200).json({ok:true,path,token:data.token});
 }
 if(b.action==="complete_task_upload"){
  const path=String(b.path||"");const name=String(b.file_name||"").slice(0,180),type=String(b.content_type||""),size=Number(b.size_bytes||0);
  if(!path.startsWith(id+"/")||path.includes("..")||!name||!["application/pdf","image/png","image/jpeg","image/webp","text/plain"].includes(type)||!Number.isInteger(size)||size<1||size>10485760)return fail(res,400,"invalid_attachment");
  const {data:list,error:listErr}=await ctx.supabase.storage.from("ssp-operations-files").list(id,{search:path.split("/").pop()});
  if(listErr||!(list||[]).some(o=>o.name===path.split("/").pop()))return fail(res,409,"upload_not_found");
  const {data,error}=await ctx.supabase.from("operations_task_attachments").insert({task_id:id,object_path:path,file_name:name,content_type:type,size_bytes:size,uploaded_by:ctx.user.id,uploader_email:ctx.user.email||""}).select("id").single();
  if(error)return fail(res,500,"attachment_save_failed");return res.status(200).json({ok:true,id:data.id});
 }
 if(b.action==="view_task_attachment"){
  const fid=String(b.attachment_id||"");if(!UUID_RE.test(fid))return fail(res,400,"invalid_attachment_id");
  const {data:file}=await ctx.supabase.from("operations_task_attachments").select("object_path").eq("id",fid).eq("task_id",id).maybeSingle();
  if(!file)return fail(res,404,"attachment_not_found");
  const {data,error}=await ctx.supabase.storage.from("ssp-operations-files").createSignedUrl(file.object_path,180);
  if(error||!data)return fail(res,500,"signed_url_failed");
  return res.status(200).json({ok:true,url:data.signedUrl});
 }
 return fail(res,400,"invalid_action");
}


async function manageStaff(ctx,res,b){
 if(String(ctx.user.email||"").toLowerCase()!=="david@selectservicepros.com")return fail(res,403,"owner_required");
 const action=String(b.action||"");
 if(action==="create_staff"){
  const first_name=String(b.first_name||"").trim(),last_name=String(b.last_name||"").trim(),name=(first_name+" "+last_name).trim(),email=String(b.email||"").trim().toLowerCase(),role=String(b.role||"Operations"),password=String(b.password||"");
  if(password.length<12||password.length>128||!first_name||!last_name||first_name.length>80||last_name.length>80||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||!["Operations","Support","Verification","Finance","Manager"].includes(role))return fail(res,400,"invalid_staff");
  const {data:account,error:authErr}=await ctx.supabase.auth.admin.createUser({email,password,email_confirm:true,app_metadata:{role:"ssp_staff"}});
  if(authErr)return fail(res,authErr.message&&authErr.message.includes("already")?409:500,"employee_login_create_failed");
  const {data,error}=await ctx.supabase.from("operations_staff").insert({name,first_name,last_name,email,role,active:true,employment_status:"Active",auth_user_id:account.user.id}).select("id,email,name,first_name,last_name,role,active,employment_status").single();
  if(error){await ctx.supabase.auth.admin.deleteUser(account.user.id);return fail(res,error.code==="23505"?409:500,"staff_create_failed");}
  await ctx.supabase.from("operations_staff_audit").insert({staff_id:data.id,actor_id:ctx.user.id,actor_email:ctx.user.email,action:"created",changes:{first_name,last_name,email,role,login_created:true}});
  return res.status(200).json({ok:true,staff:data});
 }
 if(action==="set_staff_status"){
  const id=String(b.staff_id||""),status=String(b.status||"");
  if(!UUID_RE.test(id)||!["Active","Suspended","Deactivated"].includes(status))return fail(res,400,"invalid_staff_status");
  const {data:old}=await ctx.supabase.from("operations_staff").select("*").eq("id",id).maybeSingle();
  if(!old)return fail(res,404,"staff_not_found");
  if(old.email==="david@selectservicepros.com"&&status!=="Active")return fail(res,409,"cannot_suspend_owner");
  if(old.employment_status===status)return res.status(200).json({ok:true,unchanged:true});
  const {data,error}=await ctx.supabase.from("operations_staff").update({employment_status:status,active:status==="Active"}).eq("id",id).select("*").single();
  if(error)return fail(res,500,"staff_update_failed");
  const {error:auditErr}=await ctx.supabase.from("operations_staff_audit").insert({staff_id:id,actor_id:ctx.user.id,actor_email:ctx.user.email||"",action:"status_changed",changes:{before:old.employment_status,after:status}});
  if(auditErr)return fail(res,500,"staff_audit_failed");
  return res.status(200).json({ok:true,staff:data});
 }
 return fail(res,400,"invalid_action");
}

async function humanCredentialDecision(ctx,res,b){
 if(ctx.isStaffOnly)return fail(res,403,"human_reviewer_required");
 const review_id=String(b.review_id||"");
 const decision=String(b.decision||"");
 const reason=String(b.reason||"").trim();
 const confirmed=b.independent_verified===true;
 if(!UUID_RE.test(review_id)||!["Approved","Rejected"].includes(decision)||reason.length<12||reason.length>2000)return fail(res,400,"invalid_human_decision");
 const {data,error}=await ctx.supabase.rpc("ssp_human_credential_decision",{p_review_id:review_id,p_actor_id:ctx.user.id,p_actor_email:ctx.user.email||"",p_decision:decision,p_reason:reason,p_independent_verified:confirmed});
 if(error){const msg=String(error.message||"");
 if(/document_changed|independent_verification|required|review_not_ready|credential_review|document_missing|private_document_not_available|current_official_license_confirmation_required|current_insurer_or_broker_confirmation_required/.test(msg))return fail(res,409,msg.slice(0,130));
 return fail(res,500,"credential_decision_failed");}
 return res.status(200).json(data);
}
async function requestAiReview(ctx,res,b){
 const id=String(b.task_id||"");if(!UUID_RE.test(id))return fail(res,400,"invalid_task");
 const {data:task}=await ctx.supabase.from("operations_tasks").select("id,status,automation_key").eq("id",id).maybeSingle();
 if(!task)return fail(res,404,"task_not_found");
 if(["Done","Cancelled"].includes(task.status))return fail(res,409,"task_not_open");
 const {data:existing}=await ctx.supabase.from("operations_ai_reviews").select("id").eq("task_id",id).in("status",["Queued","Running"]).maybeSingle();
 if(existing)return res.status(200).json({ok:true,review_id:existing.id,existing:true,agent_connected:true});
 const {data,error}=await ctx.supabase.from("operations_ai_reviews").insert({task_id:id,requested_by:ctx.user.id,source_event_key:task.automation_key||null}).select("id").single();
 if(error&&error.code!=="23505")return fail(res,500,"ai_review_queue_failed");
 const reviewId=data?.id||(await ctx.supabase.from("operations_ai_reviews").select("id").eq("task_id",id).eq("status","Queued").maybeSingle()).data?.id;
 if(!reviewId)return fail(res,500,"ai_review_lookup_failed");
 return res.status(200).json({ok:true,review_id:reviewId,agent_connected:false});
}
async function createAlertTask(ctx,res,b){
 const key=String(b.alert_key||"");
 const match=/^(application|dispute|notification|task|insurance):([0-9a-f-]{36})$/.exec(key);
 if(!match||!UUID_RE.test(match[2]))return fail(res,400,"invalid_alert");
 const [kind,id]=[match[1],match[2]];
 const {supabase,user}=ctx;
 if(kind==="task"){
  const {data}=await supabase.from("operations_tasks").select("id").eq("id",id).maybeSingle();
  return data?res.status(200).json({ok:true,task_id:data.id,existing:true}):fail(res,404,"task_not_found");
 }
 if(ctx.isStaffOnly)return fail(res,403,"staff_action_not_permitted");
 const assigned_to=String(b.assigned_to||"").trim().toLowerCase();
 if(!assigned_to)return fail(res,400,"employee_required");
 const {data:employee}=await supabase.from("operations_staff").select("email").eq("email",assigned_to).eq("employment_status","Active").maybeSingle();
 if(!employee)return fail(res,400,"assignee_not_employee");
 let contractor_id=null,title="",details="",active=false;
 if(kind==="application"){
  const {data}=await supabase.from("contractors").select("id,company_name,status").eq("id",id).maybeSingle();
  if(!data)return fail(res,404,"alert_not_found");
  active=["Pending Review","Pending Verification"].includes(data.status);
  contractor_id=data.id;title="Review contractor application: "+String(data.company_name||"Contractor").slice(0,105);details="Review contractor application and verification requirements.";
 }else if(kind==="insurance"){
  const {data}=await supabase.from("contractors").select("id,company_name,insurance_expiration").eq("id",id).maybeSingle();
  if(!data)return fail(res,404,"alert_not_found");
  active=!!data.insurance_expiration&&data.insurance_expiration<=new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  contractor_id=data.id;title="Renew insurance certificate: "+String(data.company_name||"Contractor").slice(0,105);
  details="Insurance expires "+String(data.insurance_expiration||"unknown")+". Obtain and review a current certificate; recording a certificate is not independent coverage verification.";
 }else if(kind==="dispute"){
  const {data}=await supabase.from("lead_disputes").select("id,contractor_id,decision").eq("id",id).maybeSingle();
  if(!data)return fail(res,404,"alert_not_found");
  active=!data.decision||String(data.decision).toLowerCase()==="pending";
  contractor_id=data.contractor_id;title="Investigate lead dispute";details="Review dispute evidence and make a decision through the dispute workflow.";
 }else{
  const {data}=await supabase.from("notification_outbox").select("id,contractor_id,event_type,status").eq("id",id).maybeSingle();
  if(!data)return fail(res,404,"alert_not_found");
  active=["failed","error","dead","dead_letter"].includes(String(data.status||"").toLowerCase());
  contractor_id=data.contractor_id;title="Investigate failed notification";details="Check notification delivery failure and retry through the approved communication workflow. Event: "+String(data.event_type||"").slice(0,200);
 }
 const automation_key="alert:"+key;
 const {data:existing}=await supabase.from("operations_tasks").select("id,status").eq("automation_key",automation_key).maybeSingle();
 if(existing){
  if(active&&["Done","Cancelled"].includes(existing.status)){
   const {error:reopenErr}=await supabase.from("operations_tasks").update({status:"Open",assigned_to,updated_at:new Date().toISOString(),updated_by:user.id}).eq("id",existing.id);
   if(reopenErr)return fail(res,500,"task_reopen_failed");
   await supabase.from("operations_task_events").insert({task_id:existing.id,actor_id:user.id,actor_email:user.email||"",event_type:"alert_reopened",after_state:{alert_key:key,assigned_to}});
  }
  return res.status(200).json({ok:true,task_id:existing.id,existing:true,status:active?"Open":existing.status});
 }
 if(!active)return fail(res,409,"alert_already_resolved");
 const {data,error}=await supabase.from("operations_tasks").insert({contractor_id,title:title.slice(0,180),details,status:"Open",priority:"High",assigned_to,created_by:user.id,updated_by:user.id,automation_key}).select("id").maybeSingle();
 if(error&&error.code!=="23505")return fail(res,500,"alert_task_create_failed");
 const task_id=data?.id||(await supabase.from("operations_tasks").select("id").eq("automation_key",automation_key).single()).data?.id;
 if(!task_id)return fail(res,500,"task_lookup_failed");
 if(data){const {error:auditErr}=await supabase.from("operations_task_events").insert({task_id,actor_id:user.id,actor_email:user.email||"",event_type:"alert_converted",after_state:{alert_key:key,assigned_to}});if(auditErr)console.error("alert task audit",auditErr.message)}
 return res.status(200).json({ok:true,task_id,existing:!data});
}
async function markOpsAlert(ctx,res,b){
 const key=String(b.alert_key||"");if(!/^(task|application|dispute|notification|insurance):[0-9a-f-]{36}$/.test(key))return fail(res,400,"invalid_alert");
 const read=b.read!==false;
 const query=ctx.supabase.from("operations_alert_reads");
 const {error}=read?await query.upsert({user_id:ctx.user.id,alert_key:key,read_at:new Date().toISOString()}):await query.delete().eq("user_id",ctx.user.id).eq("alert_key",key);
 if(error)return fail(res,500,"alert_update_failed");
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
  if(ctx.isStaffOnly && !["request_ai_review","mark_ops_alert","create_task","update_task","add_task_note","init_task_upload","complete_task_upload","view_task_attachment"].includes(action))return fail(res,403,"staff_action_not_permitted");

  if (["set_status","activate","set_insurance_verified","set_license_verified","approve_founding25","grant_founding25"].includes(action)) {
    return contractorAction(ctx, res, b);
  }
  if(["check_hvac_pilot","approve_hvac_pilot","revoke_hvac_pilot"].includes(action))return hvacPilotAction(ctx,res,b);
  if(action==="update_lead_triage")return updateLeadTriage(ctx,res,b);
  if(action==="human_credential_decision")return humanCredentialDecision(ctx,res,b);
  if(action==="request_ai_review")return requestAiReview(ctx,res,b);
  if(action==="create_alert_task")return createAlertTask(ctx,res,b);
  if(action==="mark_ops_alert")return markOpsAlert(ctx,res,b);
  if (["add_task_note","init_task_upload","complete_task_upload","view_task_attachment"].includes(action)) return taskSupplement(ctx,res,b);
  if (action === "create_task" || action === "update_task") return taskAction(ctx,res,b);
  if (["create_staff","set_staff_status"].includes(action)) return manageStaff(ctx,res,b);
  if (action === "save_profile") return saveProfile(ctx,res,b);
  if (action === "add_contractor_note") return addContractorNote(ctx, res, b);
  if (action === "document_url") return documentUrl(ctx, res, b);
  if (action === "decide_dispute") return decideDispute(ctx, res, b);

  return fail(res, 400, "invalid_action");
};
