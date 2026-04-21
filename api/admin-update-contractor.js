// /api/admin-update-contractor.js
//
// Admin-only endpoint for mutating a contractor's status. Used by
// admin-dashboard.html to approve, reject, suspend, or reactivate contractors.
// Server-side password check + service-role Supabase key (bypasses RLS).
// Only the `status` field can be updated.

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://kasqtxwbsmjlisbnebku.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "ssp2025";

const ALLOWED_STATUSES = ["Active", "Suspended", "Pending Profile", "Pending Review"];

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ success:false, error:"Method not allowed" });

  try {
    var body = req.body || {};
    var password = (body.password || "").trim();
    var contractorId = (body.contractor_id || "").trim();
    var newStatus = (body.status || "").trim();

    if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ success:false, error:"Invalid password" });
    if (!contractorId) return res.status(400).json({ success:false, error:"Missing contractor_id" });
    if (!newStatus || ALLOWED_STATUSES.indexOf(newStatus) === -1) {
      return res.status(400).json({ success:false, error:"Invalid status. Must be one of: " + ALLOWED_STATUSES.join(", ") });
    }
    if (!SUPABASE_SERVICE_KEY) return res.status(500).json({ success:false, error:"Server misconfigured: SUPABASE_SERVICE_ROLE_KEY not set" });

    var supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    var updatePayload = { status: newStatus };
    if (newStatus === "Active") updatePayload.activated_at = new Date().toISOString();

    var result = await supabase.from("contractors").update(updatePayload).eq("id", contractorId).select("id, status").single();

    if (result.error) {
      console.error("[admin-update-contractor] DB error:", result.error);
      return res.status(500).json({ success:false, error:"Failed to update: " + result.error.message });
    }
    if (!result.data) return res.status(404).json({ success:false, error:"Contractor not found" });

    return res.status(200).json({ success:true, contractor_id: result.data.id, status: result.data.status });
  } catch (err) {
    console.error("[admin-update-contractor] Uncaught:", err);
    return res.status(500).json({ success:false, error:"Internal server error" });
  }
};
