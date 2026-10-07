// api/stripe-webhook.js
// Stripe -> SSP wallet funding webhook.
//
// This file intentionally handles NO subscriptions, tiers, renewals, or
// contractor activation/suspension. SSP is free to join. A verified one-time
// wallet payment is credited exactly once through public.credit_wallet().

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://kasqtxwbsmjlisbnebku.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const ALLOWED_AMOUNTS = new Set([10000, 25000, 50000]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports.config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function creditWalletTopup(supabase, session) {
  const meta = session.metadata || {};
  if (meta.purpose !== "wallet_topup") return { ignored: true, reason: "not_wallet_topup" };

  const contractorId = String(meta.ssp_contractor_id || "");
  const metadataAmount = Number(meta.amount_cents);
  const amountCents = Number(session.amount_total);
  const currency = String(session.currency || "").toLowerCase();

  // Permanent malformed events should not retry forever. They are signed by
  // Stripe, so log them and acknowledge without mutating money.
  if (!UUID_RE.test(contractorId)) {
    console.error("stripe-webhook: malformed contractor id on wallet topup", session.id);
    return { ignored: true, reason: "invalid_contractor_id" };
  }
  if (currency !== "usd" || !Number.isInteger(amountCents) || !ALLOWED_AMOUNTS.has(amountCents)) {
    console.error("stripe-webhook: invalid wallet amount/currency", session.id, amountCents, currency);
    return { ignored: true, reason: "invalid_amount" };
  }
  if (metadataAmount !== amountCents) {
    console.error("stripe-webhook: amount metadata mismatch", session.id, metadataAmount, amountCents);
    return { ignored: true, reason: "amount_mismatch" };
  }
  if (session.payment_status !== "paid") {
    return { ignored: true, reason: "not_paid" };
  }

  const { data: contractor, error: cErr } = await supabase
    .from("contractors")
    .select("id,stripe_customer_id")
    .eq("id", contractorId)
    .single();

  if (cErr || !contractor) {
    throw new Error("contractor_lookup_failed");
  }

  const stripeCustomerId = typeof session.customer === "string" ? session.customer : null;
  if (stripeCustomerId && !contractor.stripe_customer_id) {
    const { error: linkErr } = await supabase
      .from("contractors")
      .update({ stripe_customer_id: stripeCustomerId })
      .eq("id", contractorId)
      .is("stripe_customer_id", null);
    if (linkErr) throw new Error("stripe_customer_link_failed");
  } else if (
    stripeCustomerId &&
    contractor.stripe_customer_id &&
    stripeCustomerId !== contractor.stripe_customer_id
  ) {
    // A signed session for this contractor unexpectedly belongs to a different
    // Stripe customer. Do not silently relink or credit.
    throw new Error("stripe_customer_mismatch");
  }

  const stripeRef =
    typeof session.payment_intent === "string" && session.payment_intent
      ? session.payment_intent
      : session.id;

  const { data: tx, error: rpcErr } = await supabase.rpc("credit_wallet", {
    p_contractor_id: contractorId,
    p_amount_cents: amountCents,
    p_type: "topup",
    p_idempotency_key: `stripe:${stripeRef}`,
    p_stripe_ref: stripeRef,
    p_lead_id: null,
    p_description: `Stripe wallet top-up ${session.id}`,
    p_created_by: "stripe_webhook",
  });

  if (rpcErr || !tx) {
    console.error("stripe-webhook: credit_wallet failed", rpcErr || "empty result");
    throw new Error("wallet_credit_failed");
  }

  return {
    credited: true,
    contractor_id: contractorId,
    transaction_id: tx.id || null,
    stripe_ref: stripeRef,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  if (!SUPABASE_SERVICE_KEY || !STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    console.error("stripe-webhook: required server environment missing");
    return res.status(500).json({ ok: false, error: "server_misconfigured" });
  }

  const signature = req.headers["stripe-signature"];
  if (!signature) return res.status(400).json({ ok: false, error: "missing_signature" });

  let event;
  try {
    const rawBody = await readRawBody(req);
    event = Stripe(STRIPE_SECRET_KEY).webhooks.constructEvent(
      rawBody,
      signature,
      STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("stripe-webhook: invalid signature", err && err.message);
    return res.status(400).json({ ok: false, error: "invalid_signature" });
  }

  if (![
    "checkout.session.completed",
    "checkout.session.async_payment_succeeded",
  ].includes(event.type)) {
    return res.status(200).json({ ok: true, ignored: event.type });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const result = await creditWalletTopup(supabase, event.data.object);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    // Return 500 on transient/business-processing failure. Stripe will retry,
    // and credit_wallet() is idempotent on the Stripe payment reference.
    console.error("stripe-webhook: processing failed", event.id, err && err.message);
    return res.status(500).json({ ok: false, error: "processing_failed" });
  }
};