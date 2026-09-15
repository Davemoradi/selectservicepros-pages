// api/lead-decline.js
// Contractor passes on a lead offer.
//
// SECURITY MODEL
//   Identical to lead-accept.js: contractor identity comes only from a verified
//   Supabase access token. decline_offer() is revoked from `authenticated`, so
//   this endpoint is the only path to it.
//
// LOCK ORDERING
//   decline_offer() takes lead -> offer. fill_offer_slots() also takes the lead
//   lock. They are therefore called as TWO separate RPC round-trips so the first
//   transaction commits and releases the lead lock before the second acquires
//   it. Do not merge them into one transaction.
//
//   The refill is best-effort. Until pg_cron is actually scheduled, a failed
//   refill is surfaced as refill_pending=true so it can be retried explicitly.

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://kasqtxwbsmjlisbnebku.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const STATUS_BY_REASON = {
  no_offer:          403,
  offer_accepted:    409,
  offer_declined:    409,
  offer_expired:     409,
  offer_cap_reached: 409,
};

const MESSAGE_BY_REASON = {
  no_offer:          "This lead was not offered to you.",
  offer_accepted:    "You already accepted this lead.",
  offer_declined:    "You already passed on this lead.",
  offer_expired:     "This offer already expired.",
  offer_cap_reached: "This lead has already been claimed by the maximum number of pros.",
};

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  if (!SUPABASE_SERVICE_KEY) {
    console.error("lead-decline: SUPABASE_SERVICE_ROLE_KEY missing");
    return res.status(500).json({ ok: false, error: "server_misconfigured" });
  }

  const body = req.body || {};
  const leadId = (body.lead_id || body.leadId || "").trim();
  if (!leadId) {
    return res.status(400).json({ ok: false, error: "missing_lead_id" });
  }

  // ---- 1. Verify the caller's access token -------------------------------
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return res.status(401).json({ ok: false, error: "missing_token" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let user;
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data || !data.user) {
      return res.status(401).json({ ok: false, error: "invalid_token" });
    }
    user = data.user;
  } catch (e) {
    console.error("lead-decline: token verification threw", e);
    return res.status(401).json({ ok: false, error: "invalid_token" });
  }

  // ---- 2. Resolve contractor identity ------------------------------------
  const { data: contractor, error: cErr } = await supabase
    .from("contractors")
    .select("id")
    .eq("auth_id", user.id)
    .single();

  if (cErr || !contractor) {
    return res.status(403).json({ ok: false, error: "not_a_contractor" });
  }

  // ---- 3. Reject client-supplied identity that disagrees -----------------
  const claimed = (body.contractor_id || body.contractorId || "").trim();
  if (claimed && claimed !== contractor.id) {
    console.warn(
      "lead-decline: contractor_id mismatch. authenticated=%s claimed=%s lead=%s",
      contractor.id, claimed, leadId
    );
    return res.status(403).json({ ok: false, error: "identity_mismatch" });
  }

  // ---- 4. Decline (transaction 1: lead -> offer) -------------------------
  const { data: result, error: rpcErr } = await supabase.rpc("decline_offer", {
    p_lead_id: leadId,
    p_contractor_id: contractor.id,
  });

  if (rpcErr) {
    console.error("lead-decline: decline_offer rpc failed", rpcErr);
    return res.status(500).json({ ok: false, error: "decline_failed" });
  }

  if (!result || result.ok !== true) {
    const reason = (result && result.reason) || "unknown";
    return res.status(STATUS_BY_REASON[reason] || 409).json({
      ok: false,
      error: reason,
      message: MESSAGE_BY_REASON[reason] || "This lead could not be passed on.",
    });
  }

  // ---- 5. Refill the freed slot (transaction 2, separate round-trip) -----
  // Best-effort. Cron is not scheduled yet, so surface any refill failure
  // explicitly instead of pretending there is already an automatic fallback.
  let refilled = null;
  let refillPending = false;
  try {
    const { data: made, error: fillErr } = await supabase.rpc("fill_offer_slots", {
      p_lead_id: leadId,
    });
    if (fillErr) {
      refillPending = true;
      console.error("lead-decline: fill_offer_slots failed (non-fatal)", fillErr);
    } else {
      refilled = made;
    }
  } catch (e) {
    refillPending = true;
    console.error("lead-decline: fill_offer_slots threw (non-fatal)", e);
  }

  return res.status(200).json({
    ok: true,
    refilled_slots: refilled,
    refill_pending: refillPending,
  });
};
