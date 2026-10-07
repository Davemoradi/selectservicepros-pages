// api/process-notifications.js
// Outbox worker. Server-only.
//
// OWNERSHIP BOUNDARY
//   This is the ONLY place in the application that talks to GoHighLevel, via a
//   single env var: GHL_SSP_EVENTS_WEBHOOK. It emits the event envelope
//   documented in SSP-GHL-EVENT-CONTRACT.md. It does not know or assume any
//   pipeline id, stage id, workflow id, custom-field id, tag, or template.
//   Everything on the GHL side is configured separately and is not this
//   file's concern.
//
// CONCURRENCY
//   Jobs are claimed through claim_notifications(), which uses
//   FOR UPDATE SKIP LOCKED plus a lease (locked_at / locked_by). Two workers
//   running at once cannot take the same row; a worker that dies mid-flight
//   has its lease reclaimed after the timeout.

const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const SUPABASE_URL = "https://kasqtxwbsmjlisbnebku.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GHL_SSP_EVENTS_WEBHOOK = process.env.GHL_SSP_EVENTS_WEBHOOK;
const WORKER_SECRET = process.env.NOTIFICATION_WORKER_SECRET;
const ENVIRONMENT = process.env.VERCEL_ENV || "development";

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 6;
const SEND_TIMEOUT_MS = 10000;

// Offers live 15 minutes, so backoff must stay inside that window or the
// notification lands after the offer it announces has already expired.
const OFFER_BACKOFF_SEC = [10, 30, 60, 120, 240];
const DEFAULT_BACKOFF_SEC = [30, 120, 600, 1800, 7200];

function backoffSeconds(eventType, attempt) {
  const table = eventType === "lead_offer_created" ? OFFER_BACKOFF_SEC : DEFAULT_BACKOFF_SEC;
  const base = table[Math.min(attempt - 1, table.length - 1)];
  const jitter = Math.floor(Math.random() * Math.ceil(base * 0.25)); // thundering-herd guard
  return base + jitter;
}

// Never log a full payload: post-accept events carry homeowner PII.
function safeErr(e) {
  return String((e && e.message) || e || "unknown").slice(0, 500);
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  if (!SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ ok: false, error: "server_misconfigured" });
  }
  if (!WORKER_SECRET) {
    console.error("process-notifications: NOTIFICATION_WORKER_SECRET not set");
    return res.status(500).json({ ok: false, error: "worker_secret_missing" });
  }

  // Shared-secret auth. Accepts the Vercel Cron header or an explicit bearer.
  const auth = req.headers.authorization || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7).trim()
                 : (req.headers["x-worker-secret"] || "");
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(WORKER_SECRET));
  const authorized = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!authorized) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  if (!GHL_SSP_EVENTS_WEBHOOK) {
    // Do not drain the queue into nowhere — leave jobs pending.
    return res.status(503).json({ ok: false, error: "events_webhook_not_configured" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const workerId = `vercel:${process.env.VERCEL_REGION || "local"}:${crypto.randomUUID().slice(0, 8)}`;
  const stats = { claimed: 0, sent: 0, obsolete: 0, retried: 0, dead: 0, failed: 0 };

  let jobs = [];
  try {
    const { data, error } = await supabase.rpc("claim_notifications", {
      p_worker: workerId,
      p_limit: BATCH_SIZE,
    });
    if (error) throw error;
    jobs = data || [];
  } catch (e) {
    console.error("process-notifications: claim failed", safeErr(e));
    return res.status(500).json({ ok: false, error: "claim_failed" });
  }

  stats.claimed = jobs.length;

  for (const job of jobs) {
    try {
      // ---- still relevant? ------------------------------------------------
      const relevance = await checkRelevance(supabase, job);
      if (!relevance.relevant) {
        const settled = await settle(supabase, job, workerId, "obsolete", relevance.reason);
        if (settled) stats.obsolete++; else stats.failed++;
        continue;
      }

      // ---- envelope (see SSP-GHL-EVENT-CONTRACT.md) ------------------------
      const envelope = {
        event_id: job.id,
        event_type: job.event_type,
        event_version: job.event_version,
        occurred_at: job.created_at,
        environment: ENVIRONMENT,
        source: "ssp",
        contractor_id: job.contractor_id,
        lead_id: job.lead_id,
        offer_id: job.offer_id,
        data: job.payload || {},
      };

      // ---- send -----------------------------------------------------------
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
      let resp;
      try {
        resp = await fetch(GHL_SSP_EVENTS_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(envelope),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (resp.ok) {
        const settled = await settle(supabase, job, workerId, "sent", null);
        if (settled) stats.sent++; else stats.failed++;
        continue;
      }

      // 4xx other than 429 will not succeed on retry — dead-letter immediately.
      const retryable = resp.status === 429 || resp.status >= 500;
      await settleFailure(supabase, job, workerId, `HTTP ${resp.status}`, retryable, stats);
    } catch (e) {
      // Network error, timeout, abort — all worth retrying.
      await settleFailure(supabase, job, workerId, safeErr(e), true, stats);
    }
  }

  return res.status(200).json({ ok: true, worker: workerId, ...stats });
};

// Every settle goes through the lease-conditioned RPC. A worker whose lease
// expired may still be mid-flight; without the lease check it could mark
// `sent` a job another worker has already reclaimed and is processing.
// A false return means we lost the lease — leave the row alone.
async function settle(supabase, job, workerId, status, err, nextAt) {
  const { data: ok, error } = await supabase.rpc("settle_notification", {
    p_id: job.id, p_worker: workerId, p_status: status,
    p_error: err || null, p_next_at: nextAt || null,
  });
  if (error) {
    console.error("process-notifications: settle failed", job.id, safeErr(error));
    return false;
  }
  if (ok === false) {
    console.warn("process-notifications: lease lost, not settling", job.id, job.event_type);
  }
  return ok !== false;
}

async function settleFailure(supabase, job, workerId, errText, retryable, stats) {
  const exhausted = job.attempt_count >= MAX_ATTEMPTS;
  if (!retryable || exhausted) {
    const settled = await settle(supabase, job, workerId, "dead", errText);
    if (settled) stats.dead++; else stats.failed++;
    console.error("process-notifications: dead-lettered", job.id, job.event_type, errText);
    return;
  }
  const delay = backoffSeconds(job.event_type, job.attempt_count);
  const settled = await settle(supabase, job, workerId, "retry", errText,
               new Date(Date.now() + delay * 1000).toISOString());
  if (settled) stats.retried++; else stats.failed++;
}

// Relevance gate. Sending a stale notification is worse than sending none:
// a contractor who gets an alert for an offer that expired four minutes ago
// learns to ignore the alerts — and an approval email that lands after the
// account was suspended is actively misleading.
//
// Every stateful event re-checks the CURRENT state before sending. The event
// records what happened; this decides whether telling someone still makes
// sense now.
const LIFECYCLE_EXPECTED_STATUS = {
  contractor_submitted_for_review: ["Pending Review"],
  contractor_approved:             ["Active"],
  contractor_rejected:             ["Rejected"],
  contractor_suspended:            ["Suspended"],
  contractor_deletion_requested:   ["Deletion Requested", "Deleted"],
};

async function checkRelevance(supabase, job) {
  // --- contractor lifecycle -------------------------------------------------
  const expected = LIFECYCLE_EXPECTED_STATUS[job.event_type];
  if (expected) {
    if (!job.contractor_id) return { relevant: false, reason: "no_contractor_id" };
    const { data: c, error: cErr } = await supabase
      .from("contractors").select("status").eq("id", job.contractor_id).maybeSingle();
    if (cErr) throw new Error(`contractor_relevance_query_failed:${cErr.message || cErr.code || "unknown"}`);
    if (!c) return { relevant: false, reason: "contractor_not_found" };
    if (!expected.includes(c.status)) {
      // e.g. an approval queued, then the contractor was suspended before the
      // worker drained the queue. Do not send the approval.
      return { relevant: false, reason: `superseded_status_${c.status}` };
    }
    return { relevant: true, reason: "" };
  }

  // --- lead_submitted: a completed intake fact. If the lead was deleted
  // before delivery, discard the CRM event rather than recreating a ghost.
  if (job.event_type === "lead_submitted") {
    if (!job.lead_id) return { relevant: false, reason: "no_lead_id" };
    const { data: l, error: lErr } = await supabase
      .from("leads").select("id").eq("id", job.lead_id).maybeSingle();
    if (lErr) throw new Error(`lead_relevance_query_failed:${lErr.message || lErr.code || "unknown"}`);
    if (!l) return { relevant: false, reason: "lead_not_found" };
    return { relevant: true, reason: "" };
  }

  // --- lead_unmatched -------------------------------------------------------
  if (job.event_type === "lead_unmatched") {
    const { data: l, error: lErr } = await supabase
      .from("leads").select("status").eq("id", job.lead_id).maybeSingle();
    if (lErr) throw new Error(`lead_relevance_query_failed:${lErr.message || lErr.code || "unknown"}`);
    if (!l) return { relevant: false, reason: "lead_not_found" };
    if (l.status !== "Unmatched") return { relevant: false, reason: `lead_${l.status}` };
    return { relevant: true, reason: "" };
  }

  // --- lead_accepted: terminal fact, always relevant ------------------------
  if (job.event_type === "lead_accepted") return { relevant: true, reason: "" };

  // --- lead_offer_created ---------------------------------------------------
  if (job.event_type !== "lead_offer_created") return { relevant: true, reason: "" };

  const { data: offer, error } = await supabase
    .from("lead_offers")
    .select("status, expires_at, lead_id, contractor_id")
    .eq("id", job.offer_id)
    .maybeSingle();

  if (error) throw new Error(`offer_relevance_query_failed:${error.message || error.code || "unknown"}`);
  if (!offer) return { relevant: false, reason: "offer_not_found" };
  if (offer.status !== "offered") return { relevant: false, reason: `offer_${offer.status}` };
  if (new Date(offer.expires_at) <= new Date()) return { relevant: false, reason: "offer_expired" };

  const { data: lead, error: leadErr } = await supabase
    .from("leads").select("status, matching_expires_at").eq("id", offer.lead_id).maybeSingle();
  if (leadErr) throw new Error(`lead_relevance_query_failed:${leadErr.message || leadErr.code || "unknown"}`);
  if (!lead) return { relevant: false, reason: "lead_not_found" };
  if (lead.status !== "Offering") return { relevant: false, reason: `lead_${lead.status}` };
  if (lead.matching_expires_at && new Date(lead.matching_expires_at) <= new Date()) {
    return { relevant: false, reason: "matching_closed" };
  }

  const { data: c, error: contractorErr } = await supabase
    .from("contractors").select("status").eq("id", offer.contractor_id).maybeSingle();
  if (contractorErr) throw new Error(`contractor_relevance_query_failed:${contractorErr.message || contractorErr.code || "unknown"}`);
  if (!c) return { relevant: false, reason: "contractor_not_found" };
  if (c.status !== "Active") return { relevant: false, reason: `contractor_${c.status}` };

  return { relevant: true, reason: "" };
}