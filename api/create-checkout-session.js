// api/create-checkout-session.js
// Creates a one-time Stripe Checkout Session to fund an SSP contractor wallet.
//
// SECURITY / PRODUCT MODEL
// - Free to join: this endpoint creates NO subscription and changes NO tier/status.
// - Contractor identity comes only from a verified Supabase access token.
// - Only approved preset amounts are accepted in this MVP.
// - The wallet is NOT credited here. Stripe webhook verification + credit_wallet()
//   is the only funding path, so a browser redirect can never mint balance.

const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://kasqtxwbsmjlisbnebku.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const SITE_URL = (process.env.SSP_SITE_URL || "https://www.selectservicepros.com").replace(/\/$/, "");

const ALLOWED_AMOUNTS = new Set([10000, 25000, 50000]); // $100 / $250 / $500
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

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
  if (!SUPABASE_SERVICE_KEY || !STRIPE_SECRET_KEY) {
    console.error("create-checkout-session: required server environment missing");
    return res.status(500).json({ ok: false, error: "server_misconfigured" });
  }

  const token = bearerToken(req);
  if (!token) return res.status(401).json({ ok: false, error: "missing_token" });

  const amountCents = Number(req.body && req.body.amount_cents);
  if (!Number.isInteger(amountCents) || !ALLOWED_AMOUNTS.has(amountCents)) {
    return res.status(400).json({ ok: false, error: "invalid_amount" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  const user = authData && authData.user;
  if (authErr || !user) {
    return res.status(401).json({ ok: false, error: "invalid_token" });
  }

  const { data: contractor, error: cErr } = await supabase
    .from("contractors")
    .select("id,email,first_name,last_name,company_name,status,stripe_customer_id")
    .eq("auth_id", user.id)
    .single();

  if (cErr || !contractor) {
    return res.status(403).json({ ok: false, error: "not_a_contractor" });
  }

  const claimed = String((req.body && (req.body.contractor_id || req.body.contractorId)) || "").trim();
  if (claimed && (!UUID_RE.test(claimed) || claimed !== contractor.id)) {
    return res.status(403).json({ ok: false, error: "identity_mismatch" });
  }

  if (contractor.status !== "Active") {
    return res.status(403).json({
      ok: false,
      error: "contractor_inactive",
      message: "Wallet funding is available after your contractor account is active.",
    });
  }

  const stripe = Stripe(STRIPE_SECRET_KEY);

  try {
    let customerId = contractor.stripe_customer_id || null;

    // Create the Stripe customer once the contractor actually needs billing.
    // Signup itself remains free and Stripe-independent.
    if (!customerId) {
      const fullName = [contractor.first_name, contractor.last_name].filter(Boolean).join(" ").trim();
      const customer = await stripe.customers.create({
        email: contractor.email || user.email || undefined,
        name: contractor.company_name || fullName || undefined,
        metadata: { ssp_contractor_id: contractor.id },
      });
      customerId = customer.id;

      const { data: savedCustomer, error: saveCustomerErr } = await supabase
        .from("contractors")
        .update({ stripe_customer_id: customerId })
        .eq("id", contractor.id)
        .is("stripe_customer_id", null)
        .select("stripe_customer_id")
        .maybeSingle();

      if (saveCustomerErr) {
        console.error("create-checkout-session: failed to persist Stripe customer", saveCustomerErr);
        return res.status(500).json({ ok: false, error: "billing_profile_failed" });
      }

      if (!savedCustomer) {
        // Another concurrent request won the race and stored a customer first.
        // Use the DB winner so the webhook customer-binding check remains stable.
        const { data: latest, error: latestErr } = await supabase
          .from("contractors")
          .select("stripe_customer_id")
          .eq("id", contractor.id)
          .single();
        if (latestErr || !latest || !latest.stripe_customer_id) {
          console.error("create-checkout-session: Stripe customer race could not be reconciled", latestErr);
          return res.status(500).json({ ok: false, error: "billing_profile_failed" });
        }
        const duplicateCustomerId = customerId;
        customerId = latest.stripe_customer_id;
        if (duplicateCustomerId !== customerId) {
          stripe.customers.del(duplicateCustomerId).catch((e) =>
            console.warn("create-checkout-session: duplicate Stripe customer cleanup failed", e && e.message)
          );
        }
      }
    }

    const metadata = {
      purpose: "wallet_topup",
      ssp_contractor_id: contractor.id,
      amount_cents: String(amountCents),
      pricing_model: "wallet_v1",
    };

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      payment_method_types: ["card"],
      client_reference_id: contractor.id,
      metadata,
      payment_intent_data: { metadata },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Select Service Pros wallet funds",
              description: "Prepaid funds used only when you accept a lead.",
            },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${SITE_URL}/contractor-dashboard.html?tab=billing&topup=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/contractor-dashboard.html?tab=billing&topup=cancelled`,
    });

    if (!session.url) {
      console.error("create-checkout-session: Stripe returned no checkout URL", session.id);
      return res.status(502).json({ ok: false, error: "checkout_unavailable" });
    }

    return res.status(200).json({ ok: true, url: session.url });
  } catch (err) {
    console.error("create-checkout-session: Stripe error", err && err.message);
    return res.status(502).json({ ok: false, error: "checkout_failed" });
  }
};