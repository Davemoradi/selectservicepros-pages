// api/contractor-workflow.js
// Owns contractor lifecycle status transitions and the agreement legal record.
//
// WHY THIS MOVED SERVER-SIDE
//   The dashboard used to hold the review webhook URL as a literal and POST a
//   payload built entirely from client state. The URL was public to anyone who
//   viewed source, and every field was contractor-controllable, so a contractor
//   could fire internal workflows with arbitrary values at arbitrary volume.
//
//   Here the caller is authenticated, identity is resolved from the token, and
//   every field in the payload is read from the database.
//
// STATUS TRANSITIONS
//   This endpoint also owns the `Pending Review` and `Deleted` transitions.
//   Contractors must not hold UPDATE on contractors.status — see
//   SSP-contractor-privileges.sql. The transition is applied here under the
//   service role, and only along permitted edges.

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://kasqtxwbsmjlisbnebku.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Agreement version is a SERVER constant. If the browser supplied it, a
// contractor could claim acceptance of a version they never saw.
const AGREEMENT_VERSION = "v2";

// Only these transitions may be requested by a contractor. Anything else —
// Active, Paid, Suspended — is an admin action and is not reachable here.
const ALLOWED_TRANSITIONS = {
  submit_for_review: { from: ["New", "Pending Profile", "Pending Verification"], to: "Pending Review" },
  // Excludes "Deletion Requested" so repeat calls are a no-op and cannot
  // re-fire the ops workflow.
  request_deletion:  { from: null, to: "Deletion Requested", skipIf: ["Deletion Requested", "Deleted"] },
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
    console.error("contractor-workflow: SUPABASE_SERVICE_ROLE_KEY missing");
    return res.status(500).json({ ok: false, error: "server_misconfigured" });
  }

  const body = req.body || {};
  const action = (body.action || "").trim();
  if (!ALLOWED_TRANSITIONS[action]) {
    return res.status(400).json({ ok: false, error: "unknown_action" });
  }

  // ---- 1. Verify token -----------------------------------------------------
  const authHeader = req.headers.authorization || req.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return res.status(401).json({ ok: false, error: "missing_token" });

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
    console.error("contractor-workflow: token verification threw", e);
    return res.status(401).json({ ok: false, error: "invalid_token" });
  }

  // ---- 2. Resolve identity from the token, never from the body ------------
  const { data: contractor, error: cErr } = await supabase
    .from("contractors")
    .select("*")
    .eq("auth_id", user.id)
    .single();

  if (cErr || !contractor) {
    return res.status(403).json({ ok: false, error: "not_a_contractor" });
  }

  const claimed = (body.contractor_id || body.contractorId || "").trim();
  if (claimed && claimed !== contractor.id) {
    console.warn(
      "contractor-workflow: contractor_id mismatch. authenticated=%s claimed=%s",
      contractor.id, claimed
    );
    return res.status(403).json({ ok: false, error: "identity_mismatch" });
  }

  // ---- 3. Apply the status transition (service role) ----------------------
  const rule = ALLOWED_TRANSITIONS[action];

  // Idempotency: already in a terminal state for this action -> succeed
  // without re-writing and without re-firing the workflow.
  if (rule.skipIf && rule.skipIf.includes(contractor.status)) {
    return res.status(200).json({ ok: true, status: contractor.status, already: true });
  }

  if (rule.from && !rule.from.includes(contractor.status)) {
    return res.status(409).json({
      ok: false,
      error: "invalid_transition",
      message: "Your account is not in a state that allows this request.",
    });
  }

  // The agreement acceptance record is a legal artifact: signed name, IP, and
  // timestamp. The contractor must not be able to write or backdate it from
  // the browser, so it is recorded here alongside the status transition.
  const patch = { status: rule.to };

  if (action === "submit_for_review") {
    const signedName = String(body.signed_name || "").trim().slice(0, 200);
    // Same rule the browser enforces — two name-like parts. Validating only
    // "non-empty" here would let a direct API call sign with "x".
    const LOOKS_LIKE_NAME = /^[A-Za-z][A-Za-z .'\-]*\s+[A-Za-z][A-Za-z .'\-]*$/;
    if (!signedName || !LOOKS_LIKE_NAME.test(signedName)) {
      return res.status(400).json({
        ok: false,
        error: "invalid_signed_name",
        message: "Enter your full legal name (first and last).",
      });
    }
    const fwd = req.headers["x-forwarded-for"] || "";
    patch.agreement_accepted_at = new Date().toISOString();   // server clock
    patch.agreement_accepted_ip = String(fwd).split(",")[0].trim() || null;
    patch.agreement_version     = AGREEMENT_VERSION;          // server constant
    // The agreement text states SSP records the user agent. Capture it from
    // the request header so the promise and the record match.
    patch.agreement_accepted_user_agent =
      String(req.headers["user-agent"] || "").slice(0, 500) || null;
    patch.agreement_signed_name = signedName;
  }

  if (action === "request_deletion") {
    patch.deletion_requested_at = new Date().toISOString();
  }

  // Conditional on the ORIGINAL status as well as the id. Without this there
  // is a read-check-write race: two concurrent calls both pass the check above
  // and both write, firing the workflow twice.
  const { data: updated, error: upErr } = await supabase
    .from("contractors")
    .update(patch)
    .eq("id", contractor.id)
    .eq("status", contractor.status)
    .select("id, status");

  if (upErr) {
    console.error("contractor-workflow: status update failed", upErr);
    return res.status(500).json({ ok: false, error: "status_update_failed" });
  }

  // Zero rows means the status changed under us. Returning {ok:true,
  // already:true} for every such case would tell a contractor their
  // submission succeeded when an admin had just rejected them. Distinguish:
  //   - actual == the idempotent target  -> genuinely already done, 200
  //   - actual is something else         -> a real conflict, 409
  if (!updated || updated.length === 0) {
    const { data: current } = await supabase
      .from("contractors").select("status").eq("id", contractor.id).single();
    const actual = (current && current.status) || null;

    if (actual && rule.skipIf && rule.skipIf.includes(actual)) {
      return res.status(200).json({ ok: true, status: actual, already: true });
    }
    if (actual === rule.to) {
      return res.status(200).json({ ok: true, status: actual, already: true });
    }
    return res.status(409).json({
      ok: false,
      error: "status_conflict",
      status: actual,
      message: "Your account status changed. Refresh and try again.",
    });
  }

  return res.status(200).json({ ok: true, status: rule.to });
};