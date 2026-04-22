// /api/stripe-webhook.js
// Vercel serverless function — handles Stripe webhook events.
//
// Requires these Vercel environment variables:
//   STRIPE_SECRET_KEY         (sk_live_... in production, sk_test_... in test mode)
//   STRIPE_WEBHOOK_SECRET     (whsec_... — get from Stripe Dashboard → Webhooks → your endpoint)
//   SUPABASE_URL              (https://kasqtxwbsmjlisbnebku.supabase.co)
//   SUPABASE_SERVICE_ROLE_KEY (service_role key, NOT anon — needs to bypass RLS to update contractors)
//
// Webhook endpoint URL (give this to Stripe when creating the webhook):
//   https://www.selectservicepros.com/api/stripe-webhook
//
// Events subscribed:
//   - checkout.session.completed    → activate contractor, save stripe IDs
//   - customer.subscription.deleted → suspend contractor (card removed, subscription cancelled)
//   - invoice.payment_failed        → logged only (Stripe Smart Retries handles the retry)
//   - invoice.payment_succeeded     → logged only (no action needed; kept for future MRR tracking)
//
// Idempotency: every event's event.id is recorded in stripe_events BEFORE processing.
// If Stripe retries (timeout, non-2xx), the duplicate is detected and returns 200 without re-processing.

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

// CRITICAL: disable Vercel's default body parser so we can verify the raw signature.
// Stripe's constructEvent() needs the exact bytes Stripe sent, not a re-serialized JSON.
module.exports.config = {
  api: {
    bodyParser: false
  }
};

// Read the raw request body from the stream. Stripe signature verification fails
// if the body has been parsed, re-serialized, or mutated in any way.
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL || 'https://kasqtxwbsmjlisbnebku.supabase.co';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeSecretKey || !webhookSecret || !supabaseKey) {
    console.error('Missing required env vars:', {
      hasStripeKey: !!stripeSecretKey,
      hasWebhookSecret: !!webhookSecret,
      hasSupabaseKey: !!supabaseKey
    });
    return res.status(500).json({ error: 'Server misconfigured' });
  }

  const stripe = Stripe(stripeSecretKey);
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Step 1: read raw body + verify signature
  let event;
  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers['stripe-signature'];
    if (!signature) {
      return res.status(400).json({ error: 'Missing Stripe-Signature header' });
    }
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    // Signature verification failure — usually means:
    //   (a) wrong STRIPE_WEBHOOK_SECRET (test vs live mismatch)
    //   (b) body was parsed by something upstream (shouldn't happen with bodyParser:false)
    //   (c) actual attack — someone is sending fake webhooks
    console.error('Stripe signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature: ' + err.message });
  }

  // Step 2: idempotency check — has this event been processed before?
  try {
    const { data: existing } = await supabase
      .from('stripe_events')
      .select('event_id, processing_result')
      .eq('event_id', event.id)
      .maybeSingle();

    if (existing) {
      console.log('Duplicate event ' + event.id + ' (' + event.type + ') — already processed: ' + existing.processing_result);
      return res.status(200).json({ received: true, duplicate: true });
    }
  } catch (e) {
    console.warn('Idempotency check failed (will process anyway):', e.message);
  }

  // Step 3: route event to handler
  let result = 'ignored';
  let contractorId = null;
  try {
    if (event.type === 'checkout.session.completed') {
      const r = await handleCheckoutCompleted(stripe, supabase, event.data.object);
      result = r.result;
      contractorId = r.contractorId;
    } else if (event.type === 'customer.subscription.deleted') {
      const r = await handleSubscriptionDeleted(supabase, event.data.object);
      result = r.result;
      contractorId = r.contractorId;
    } else if (event.type === 'invoice.payment_failed') {
      // Log only for now. Stripe Smart Retries will attempt the payment 4 more times
      // over a few days. If all retries fail, 'customer.subscription.deleted' fires
      // and the contractor is auto-suspended. We can add a proactive email here later.
      console.log('invoice.payment_failed for customer ' + event.data.object.customer);
      result = 'logged';
    } else if (event.type === 'invoice.payment_succeeded') {
      // No action yet. Future: track MRR / lead fee settlements per invoice.
      result = 'logged';
    } else {
      console.log('Unhandled event type: ' + event.type);
      result = 'ignored:' + event.type;
    }
  } catch (err) {
    console.error('Handler error for ' + event.type + ':', err);
    result = 'error: ' + err.message;
    // Record the error but still return 200 so Stripe doesn't retry forever.
    // The stripe_events row captures the failure for manual review.
  }

  // Step 4: record the event (even on error) for idempotency + audit
  try {
    await supabase.from('stripe_events').insert({
      event_id: event.id,
      event_type: event.type,
      contractor_id: contractorId,
      payload: event,
      processing_result: result
    });
  } catch (e) {
    console.warn('Failed to record stripe_event:', e.message);
  }

  return res.status(200).json({ received: true, result: result });
};

// ============================================================
// Event handlers
// ============================================================

async function handleCheckoutCompleted(stripe, supabase, session) {
  // session shape for subscription mode:
  //   session.customer              = 'cus_...'
  //   session.subscription          = 'sub_...'
  //   session.customer_email        = buyer email
  //   session.metadata.plan_id      = 'basic' | 'pro' | 'elite' (we set this in create-checkout-session.js)
  //   session.metadata.contractor_* = name/phone/company snapshot

  const email = (session.customer_email || session.customer_details?.email || '').toLowerCase().trim();
  const planId = session.metadata?.plan_id;
  const tier = planId ? planId.charAt(0).toUpperCase() + planId.slice(1) : null; // 'basic' -> 'Basic'

  if (!email) {
    console.warn('checkout.session.completed with no email — cannot match contractor. Session: ' + session.id);
    return { result: 'error:no_email', contractorId: null };
  }

  // Find the contractor row. Matches by email (case-insensitive).
  const { data: contractor, error: findErr } = await supabase
    .from('contractors')
    .select('id, status, email, stripe_customer_id')
    .ilike('email', email)
    .maybeSingle();

  if (findErr) {
    console.error('Supabase lookup error:', findErr);
    return { result: 'error:lookup_failed', contractorId: null };
  }

  if (!contractor) {
    // No matching contractor row yet. This shouldn't happen if signup flow is intact
    // (create-contractor.js runs BEFORE checkout and inserts the row), but log it so
    // we can backfill manually.
    console.warn('No contractor found for email ' + email + ' (session ' + session.id + '). Manual review needed.');
    return { result: 'error:no_contractor_row', contractorId: null };
  }

  // Update the contractor: save Stripe IDs, set tier, flip status.
  // We set status to 'Pending Verification' (not 'Active') because the contractor still
  // needs COI + license review before lead routing turns on. 'Pending Verification' is
  // the signal to admin that money is in, review is owed.
  const update = {
    stripe_customer_id: session.customer || null,
    stripe_subscription_id: session.subscription || null,
    membership_tier: tier || 'Basic',
    status: 'Pending Verification',
    updated_at: new Date().toISOString()
  };

  const { error: updateErr } = await supabase
    .from('contractors')
    .update(update)
    .eq('id', contractor.id);

  if (updateErr) {
    console.error('Failed to update contractor ' + contractor.id + ':', updateErr);
    return { result: 'error:update_failed', contractorId: contractor.id };
  }

  console.log('checkout.session.completed: contractor ' + contractor.id + ' now ' + update.status + ' on tier ' + update.membership_tier);
  return { result: 'ok:activated', contractorId: contractor.id };
}

async function handleSubscriptionDeleted(supabase, subscription) {
  // Fires when a subscription ends — either contractor cancelled or Stripe cancelled
  // after all retry attempts failed. In both cases: stop routing leads.
  const customerId = subscription.customer;
  if (!customerId) return { result: 'error:no_customer', contractorId: null };

  const { data: contractor, error } = await supabase
    .from('contractors')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();

  if (error || !contractor) {
    console.warn('subscription.deleted: no contractor found for customer ' + customerId);
    return { result: 'error:no_match', contractorId: null };
  }

  const { error: updErr } = await supabase
    .from('contractors')
    .update({ status: 'Suspended', updated_at: new Date().toISOString() })
    .eq('id', contractor.id);

  if (updErr) {
    console.error('Failed to suspend contractor ' + contractor.id + ':', updErr);
    return { result: 'error:update_failed', contractorId: contractor.id };
  }

  console.log('subscription.deleted: contractor ' + contractor.id + ' suspended');
  return { result: 'ok:suspended', contractorId: contractor.id };
}
