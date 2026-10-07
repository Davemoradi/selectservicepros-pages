// api/admin-update-contractor.js — admin-only contractor operations.
const { requireAdmin } = require("./_admin-auth");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_STATUSES = new Set(["Suspended","Pending Profile","Pending Review","Rejected","Deletion Requested"]);

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "POST") return res.status(405).json({ ok:false, error:"method_not_allowed" });

  let ctx;
  try { ctx = await requireAdmin(req); }
  catch (e) { return res.status(e.status || 500).json({ ok:false, error:e.message || "admin_auth_failed" }); }
  const { supabase, user } = ctx;
  const b = req.body || {};
  const action = String(b.action || "");
  const contractorId = String(b.contractor_id || "");
  if (!UUID_RE.test(contractorId)) return res.status(400).json({ ok:false, error:"invalid_contractor_id" });

  try {
    if (action === "set_status") {
      const status = String(b.status || "");
      if (!ALLOWED_STATUSES.has(status)) return res.status(400).json({ ok:false, error:"invalid_status" });
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
          return res.status(409).json({ ok:false, error:"activation_not_ready", detail:msg.split("activation_not_ready:")[1] || "requirements_not_met" });
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
      const licenseId = String(b.license_id || "");
      if (!UUID_RE.test(licenseId)) return res.status(400).json({ ok:false, error:"invalid_license_id" });
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
      const { data, error } = await supabase.rpc("approve_founding25_contractor", {
        p_contractor_id: contractorId,
      });
      if (error) {
        const msg = String(error.message || "");
        if (msg.includes("founding25_full")) return res.status(409).json({ ok:false, error:"founding25_full" });
        if (msg.includes("activation_not_ready:")) return res.status(409).json({ ok:false, error:"activation_not_ready", detail:msg.split("activation_not_ready:")[1] || "requirements_not_met" });
        throw error;
      }
      return res.status(200).json({ ok:true, result:data });
    }

    if (action === "grant_founding25") {
      const { data, error } = await supabase.rpc("grant_founding25_promo", {
        p_contractor_id: contractorId,
      });
      if (error) {
        if (String(error.message || "").includes("founding25_full")) return res.status(409).json({ ok:false, error:"founding25_full" });
        throw error;
      }
      return res.status(200).json({ ok:true, transaction:data });
    }

    return res.status(400).json({ ok:false, error:"invalid_action" });
  } catch (err) {
    console.error("admin-update-contractor:", action, err && err.message);
    return res.status(500).json({ ok:false, error:"admin_update_failed" });
  }
};