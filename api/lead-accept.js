// api/lead-accept.js
// Contractor accepts a lead offer.
//
// SECURITY MODEL
//   The contractor identity is derived ONLY from a verified Supabase access
//   token. A contractor_id supplied by the client is never trusted; if one is
//   present and disagrees with the resolved identity, the request is rejected
//   as a tampering attempt.
//
//   accept_lead() is REVOKED from the `authenticated` role, so the browser
//   cannot call it directly. This endpoint is the only path, and it runs under
//   the service role after authenticating the caller.
//
//   Homeowner PII is returned ONLY after accept_lead() reports success, which
//   means the wallet debit has already committed.

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://kasqtxwbsmjlisbnebku.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// reason -> HTTP status
const STATUS_BY_REASON = {
  lead_not_found:      404,
  no_offer:            403,
  contractor_not_found:403,
  contractor_inactive: 403,
  insufficient_funds:  402,   // Payment Required
  matching_closed:     409,
  lead_not_offering:   409,
  cap_reached:         409,
  offer_expired:       409,
  offer_accepted:      409,
  offer_declined:      409,
  offer_cap_reached:   409,
};

// user-facing copy; never leak internal state names
const MESSAGE_BY_REASON = {
  lead_not_found:      "That lead no longer exists.",
  no_offer:            "This lead was not offered to you.",
  contractor_not_found:"Your contractor account could not be found.",
  contractor_inactive: "Your account is not active. Contact support to reactivate.",
  insufficient_funds:  "Not enough wallet balance to accept this lead. Add funds and try again.",
  matching_closed:     "Matching has closed for this lead.",
  lead_not_offering:   "This lead is no longer available.",
  cap_reached:         "This lead has already been claimed by the maximum number of pros.",
  offer_expired:       "This offer expired. Offers are open for 15 minutes.",
  offer_accepted:      "You have already accepted this lead.",
  offer_declined:      "You already passed on this lead.",
  offer_cap_reached:   "This lead has already been claimed by the maximum number of pros.",
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
  if (!SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY) {
    console.error("lead-accept: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY missing");
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
    console.error("lead-accept: token verification threw", e);
    return res.status(401).json({ ok: false, error: "invalid_token" });
  }

  // ---- 2. Resolve contractor identity from the verified user -------------
  const { data: contractor, error: cErr } = await supabase
    .from("contractors")
    .select("id, status")
    .eq("auth_id", user.id)
    .single();

  if (cErr || !contractor) {
    return res.status(403).json({ ok: false, error: "not_a_contractor" });
  }

  // ---- 3. Reject any client-supplied identity that disagrees -------------
  const claimed = (body.contractor_id || body.contractorId || "").trim();
  if (claimed && claimed !== contractor.id) {
    console.warn(
      "lead-accept: contractor_id mismatch. authenticated=%s claimed=%s lead=%s",
      contractor.id, claimed, leadId
    );
    return res.status(403).json({ ok: false, error: "identity_mismatch" });
  }

  // ---- 4. Atomic accept (lead -> offer -> contractor/wallet) -------------
  const { data: result, error: rpcErr } = await supabase.rpc("accept_lead", {
    p_lead_id: leadId,
    p_contractor_id: contractor.id,
  });

  if (rpcErr) {
    console.error("lead-accept: accept_lead rpc failed", rpcErr);
    return res.status(500).json({ ok: false, error: "accept_failed" });
  }

  if (!result || result.ok !== true) {
    const reason = (result && result.reason) || "unknown";
    return res.status(STATUS_BY_REASON[reason] || 409).json({
      ok: false,
      error: reason,
      message: MESSAGE_BY_REASON[reason] || "This lead could not be accepted.",
    });
  }

  // ---- 5. Debit committed. Release PII only through the accepted-lead RPC. -
  // Use the caller's JWT, not the service role, so the database remains the
  // permanent authorization gate for homeowner details.
  let lead = null;
  try {
    const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: leadRows, error: lErr } = await userSupabase.rpc(
      "get_accepted_lead",
      { p_lead_id: leadId }
    );

    if (lErr) {
      // The charge succeeded; only the detail read failed. Do not fail the
      // request — the contractor can refetch through get_accepted_lead().
      console.error("lead-accept: get_accepted_lead failed after successful accept", lErr);
    } else if (Array.isArray(leadRows)) {
      lead = leadRows[0] || null;
    } else {
      lead = leadRows || null;
    }
  } catch (e) {
    // Never turn a committed charge into an HTTP failure just because the
    // follow-up detail read failed.
    console.error("lead-accept: accepted-lead detail fetch threw", e);
  }

  return res.status(200).json({
    ok: true,
    transaction_id: result.transaction_id,
    charged_cents: Math.abs(
      (result.promo_delta_cents || 0) + (result.paid_delta_cents || 0)
    ),
    promo_delta_cents: result.promo_delta_cents,
    paid_delta_cents: result.paid_delta_cents,
    accepted_count: result.accepted_count,
    lead,
  });
};
