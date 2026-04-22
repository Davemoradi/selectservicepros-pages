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

// Fires the GHL inbound webhook that WF5 (Contractor Welcome Email) listens on.
// Trigger spec: contractor finished paying on Stripe → status flipped to
// 'Pending Verification' → send welcome email with Finish Your Setup CTA.
//
// Uses the same webhook URL pattern as create-contractor.js so the WF5 template
// variables resolve correctly no matter which path creates the contractor.
//
// WF5 reads fields as camelCase ({{inboundWebhookRequest.firstName}}), so we
// translate our snake_case internal shape into the camelCase shape WF5 expects.
// We also send the snake_case versions so older parts of the workflow that
// used them (if any) continue to work. Keep both until WF5 is fully verified.
//
// Non-fatal: logs + swallows errors. The payment still succeeded and the DB
// row is correct; at worst the contractor just doesn't get the email.
async function fireWelcomeWebhook(payload) {
  const WF5_URL = 'https://services.leadconnectorhq.com/hooks/QfDToN545k1TOpFZa5AQ/webhook-trigger/Ny618W28bwWSntyu1DyL';

  // Build the outbound payload with BOTH snake_case (our internal convention)
  // and camelCase (what WF5 template reads). Sending both is cheap and avoids
  // breaking existing consumers.
  const outbound = Object.assign({}, payload, {
    firstName:      payload.first_name      || '',
    lastName:       payload.last_name       || '',
    companyName:    payload.company_name    || '',
    phone:          payload.phone           || '',
    email:          payload.email           || '',
    membershipTier: payload.membership_tier || '',
    contractorId:   payload.contractor_id   || ''
  });

  try {
    const resp = await fetch(WF5_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(outbound)
    });
    if (!resp.ok) {
      console.warn('WF5 webhook returned non-2xx: ' + resp.status + ' for ' + payload.email);
    } else {
      console.log('WF5 welcome email fired for ' + payload.email);
    }
  } catch (e) {
    console.warn('WF5 webhook fetch failed for ' + payload.email + ':', e.message);
  }
}

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
  // Pulls name/phone/company so we can fire WF5 with template data without
  // an extra round-trip after update.
  const { data: contractor, error: findErr } = await supabase
    .from('contractors')
    .select('id, status, email, stripe_customer_id, first_name, last_name, phone, company_name')
    .ilike('email', email)
    .maybeSingle();

  if (findErr) {
    console.error('Supabase lookup error:', findErr);
    return { result: 'error:lookup_failed', contractorId: null };
  }

  if (!contractor) {
    // Race condition path. The signup flow calls /api/create-checkout-session BEFORE
    // /api/create-contractor, which means Stripe's webhook can arrive faster than the
    // contractor row is inserted. Rather than error out (and leave the customer paid
    // but unprovisioned), we insert the row here from checkout metadata. Option B.
    //
    // This also makes the webhook the source of truth for "paid → provisioned":
    // even if /api/create-contractor fails silently post-payment, we still end up
    // with a contractor row linked to the Stripe IDs.
    const meta = session.metadata || {};
    const fullName = (meta.contractor_name || '').trim();
    const spaceIdx = fullName.indexOf(' ');
    const firstName = spaceIdx > 0 ? fullName.substring(0, spaceIdx) : (fullName || 'Unknown');
    const lastName  = spaceIdx > 0 ? fullName.substring(spaceIdx + 1) : 'Unknown';

    const insertRow = {
      email: email,
      first_name: firstName,
      last_name: lastName,
      phone: meta.contractor_phone || null,
      company_name: meta.contractor_company || null,
      membership_tier: tier || 'Basic',
      status: 'Pending Verification',
      stripe_customer_id: session.customer || null,
      stripe_subscription_id: session.subscription || null
    };

    const { data: created, error: insertErr } = await supabase
      .from('contractors')
      .insert(insertRow)
      .select('id')
      .single();

    if (insertErr) {
      // One common cause: /api/create-contractor won the race and inserted the row
      // between our lookup and our insert (duplicate email, unique constraint fail).
      // Retry the lookup and update instead.
      if (insertErr.code === '23505' || /duplicate/i.test(insertErr.message || '')) {
        console.log('Contractor inserted by other path during race; retrying lookup for ' + email);
        const { data: retry } = await supabase
          .from('contractors')
          .select('id')
          .ilike('email', email)
          .maybeSingle();
        if (retry) {
          const { error: updErr2 } = await supabase
            .from('contractors')
            .update({
              stripe_customer_id: session.customer || null,
              stripe_subscription_id: session.subscription || null,
              membership_tier: tier || 'Basic',
              status: 'Pending Verification',
              updated_at: new Date().toISOString()
            })
            .eq('id', retry.id);
          if (updErr2) {
            console.error('Race-retry update failed for ' + retry.id + ':', updErr2);
            return { result: 'error:race_retry_failed', contractorId: retry.id };
          }
          console.log('Race-retry succeeded for contractor ' + retry.id);
          // Fetch the now-complete row so we can fire WF5 with real name data
          // (the existing row may have richer data than Stripe metadata alone).
          try {
            const { data: full } = await supabase
              .from('contractors')
              .select('first_name, last_name, phone, company_name, membership_tier')
              .eq('id', retry.id)
              .single();
            if (full) {
              await fireWelcomeWebhook({
                email: email,
                first_name: full.first_name || '',
                last_name: full.last_name || '',
                phone: full.phone || '',
                company_name: full.company_name || '',
                membership_tier: full.membership_tier || tier || 'Basic',
                status: 'Pending Verification',
                contractor_id: retry.id,
                source: 'stripe_webhook:race_retry'
              });
            }
          } catch (_) { /* non-fatal */ }
          return { result: 'ok:activated_after_race', contractorId: retry.id };
        }
      }
      console.error('Failed to insert contractor from webhook (' + email + '):', insertErr);
      return { result: 'error:insert_failed', contractorId: null };
    }

    console.log('checkout.session.completed: inserted new contractor ' + created.id + ' for ' + email + ' on tier ' + (tier || 'Basic'));
    await fireWelcomeWebhook({
      email: email,
      first_name: firstName,
      last_name: lastName,
      phone: meta.contractor_phone || '',
      company_name: meta.contractor_company || '',
      membership_tier: tier || 'Basic',
      status: 'Pending Verification',
      contractor_id: created.id,
      source: 'stripe_webhook:inserted'
    });
    return { result: 'ok:inserted', contractorId: created.id };
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
  await fireWelcomeWebhook({
    email: email,
    first_name: contractor.first_name || '',
    last_name: contractor.last_name || '',
    phone: contractor.phone || '',
    company_name: contractor.company_name || '',
    membership_tier: update.membership_tier,
    status: update.status,
    contractor_id: contractor.id,
    source: 'stripe_webhook:activated'
  });
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
