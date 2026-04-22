const { createClient } = require('@supabase/supabase-js');

// Creates a new contractor account from the signup form.
//
// Ownership / race considerations:
//   - /api/create-checkout-session opens Stripe Checkout BEFORE this runs
//   - On payment success, Stripe fires webhook → /api/stripe-webhook
//   - stripe-webhook.js may INSERT a contractor row before this file finishes
//   - This file creates the auth.users row + password reset link, and MUST
//     converge on the same contractor row regardless of order.
//
// Flow:
//   1. Create Supabase auth.users (always new — email is unique in auth)
//   2. Generate password recovery link
//   3. UPSERT contractor row keyed on email:
//        - If no row yet → insert fresh (normal fast path)
//        - If row already exists (stripe-webhook beat us) → update, adding
//          auth_id + profile fields, preserving Stripe IDs that webhook set
//   4. Fire WF5 welcome email with passwordResetUrl
//   5. Fire GHL contact upsert webhook

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    email, firstName, lastName, phone,
    companyName, planName,
    businessDescription, yearsInBusiness, numEmployees,
    licenseNumber, licenseType,
    serviceZips, services, serviceCategories,
    websiteUrl
  } = req.body;

  if (!email || !firstName || !lastName) {
    return res.status(400).json({ error: 'Missing required fields: email, firstName, lastName' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // 1. Create Supabase auth user with auto-confirm and random password.
    // If the user already exists (e.g. someone retries signup), surface the
    // error so the frontend can offer a login flow instead.
    const randomPassword = Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-12);
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email,
      password: randomPassword,
      email_confirm: true,
      user_metadata: { firstName, lastName, companyName }
    });

    if (authError) {
      console.error('Auth error:', authError.message);
      return res.status(500).json({ error: 'Failed to create auth user: ' + authError.message });
    }

    const authId = authData.user.id;
    console.log('Auth user created:', authId);

    // 1b. Generate password recovery link (contractor clicks this to set their password)
    let passwordResetUrl = 'https://www.selectservicepros.com/contractor-login.html';
    try {
      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: 'recovery',
        email: email,
        options: {
          // After Supabase verifies the recovery token, it redirects the
          // browser here. Must be /reset-password.html so the user lands
          // on the "Set a new password" form — NOT /contractor-login.html
          // which just shows a sign-in form with no context.
          redirectTo: 'https://www.selectservicepros.com/reset-password.html'
        }
      });
      if (linkError) {
        console.error('Recovery link error:', linkError.message);
      } else if (linkData && linkData.properties && linkData.properties.action_link) {
        passwordResetUrl = linkData.properties.action_link;
        console.log('Recovery link generated for:', email);
      }
    } catch (linkErr) {
      console.error('Recovery link generation failed:', linkErr.message);
    }

    // 2. UPSERT contractor profile into contractors table.
    //
    // Why upsert not insert: the Stripe webhook race. When the webhook fires
    // first (common with fast Stripe events), it inserts a minimal contractor
    // row with email + metadata + Stripe IDs. This file then runs and needs
    // to ADD the rest of the profile data (license, services, insurance, etc)
    // plus link the auth_id — not fail silently.
    //
    // We do "find-then-update-or-insert" manually rather than supabase's
    // .upsert() because the natural key here is email (not id), and we want
    // to preserve any Stripe IDs the webhook already wrote.
    const profileFields = {
      auth_id: authId,
      first_name: firstName,
      last_name: lastName,
      phone: phone || null,
      company_name: companyName || null,
      membership_tier: planName || 'Basic',
      business_description: businessDescription || null,
      years_in_business: yearsInBusiness || null,
      number_of_employees: numEmployees || null,
      license_number: licenseNumber || null,
      license_type: licenseType || null,
      service_zips: serviceZips || null,
      services: services || null,
      service_categories: serviceCategories || null,
      website_url: websiteUrl || null,
      // Don't overwrite status if webhook already set it to 'Pending Verification'
      // (meaning they paid). Only set 'Pending Profile' when row is brand new.
    };

    // Check if a row already exists for this email (likely pre-created by webhook)
    const { data: existing, error: findErr } = await supabase
      .from('contractors')
      .select('id, status, stripe_customer_id, stripe_subscription_id')
      .ilike('email', email)
      .maybeSingle();

    if (findErr) {
      console.error('Contractor lookup error:', findErr.message);
    }

    if (existing && existing.id) {
      // Row exists — update with profile data, keep Stripe IDs + Stripe-set status.
      console.log('Contractor row exists (id=' + existing.id + '), updating with profile data');
      const { error: updateErr } = await supabase
        .from('contractors')
        .update(Object.assign({}, profileFields, { updated_at: new Date().toISOString() }))
        .eq('id', existing.id);
      if (updateErr) {
        console.error('Update error:', updateErr.message);
      }
    } else {
      // No row yet — fresh insert with Pending Profile status.
      const insertRow = Object.assign({}, profileFields, {
        email: email,
        status: 'Pending Profile',
        lead_count: 0,
        acceptance_rate: 0
      });
      const { error: insertError } = await supabase.from('contractors').insert(insertRow);
      if (insertError) {
        // Final fallback: maybe webhook inserted BETWEEN our lookup and insert
        // (unlikely but possible). Retry as an update.
        if (insertError.code === '23505' || /duplicate/i.test(insertError.message || '')) {
          console.log('Insert race detected, retrying as update for ' + email);
          const { error: retryErr } = await supabase
            .from('contractors')
            .update(Object.assign({}, profileFields, { updated_at: new Date().toISOString() }))
            .ilike('email', email);
          if (retryErr) console.error('Retry update error:', retryErr.message);
        } else {
          console.error('Insert error:', insertError.message);
        }
      }
    }

    // 3. Call GHL webhooks server-side (reliable, no CORS issues)
    const GHL_CONTACT_WEBHOOK = 'https://services.leadconnectorhq.com/hooks/QfDToN545k1TOpFZa5AQ/webhook-trigger/a65106d8-9948-4122-9364-bddcc07aca5c';
    const GHL_WF5_WEBHOOK = 'https://services.leadconnectorhq.com/hooks/QfDToN545k1TOpFZa5AQ/webhook-trigger/Ny618W28bwWSntyu1DyL';

    const ghlPayload = {
      name: firstName + ' ' + lastName,
      firstName: firstName,
      lastName: lastName,
      phone: phone || '',
      email: email,
      companyName: companyName || '',
      source: 'SelectServicePros.com — Contractor Signup',
      type: 'contractor',
      contractor_services: services || '',
      contractor_service_categories: serviceCategories || '',
      contractor_service_zips: serviceZips || '',
      contractor_membership_tier: planName || 'Basic',
      contractor_status: 'Pending Profile',
      passwordResetUrl: passwordResetUrl,
      lead_id: 'SSP-PAID-' + Date.now()
    };

    // 3a. Create/update GHL contact
    try {
      const ghlResp = await fetch(GHL_CONTACT_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ghlPayload)
      });
      const ghlResult = await ghlResp.text();
      console.log('GHL contact webhook:', ghlResp.status, ghlResult);
    } catch (ghlErr) {
      console.error('GHL contact webhook error:', ghlErr.message);
    }

    // 3b. Trigger WF5 welcome email workflow
    try {
      const wf5Resp = await fetch(GHL_WF5_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ghlPayload)
      });
      const wf5Result = await wf5Resp.text();
      console.log('GHL WF5 webhook:', wf5Resp.status, wf5Result);
    } catch (wf5Err) {
      console.error('GHL WF5 webhook error:', wf5Err.message);
    }

    console.log('Account created for:', email);

    return res.status(200).json({
      success: true,
      message: 'Account created — check your email to set your password',
      // passwordResetUrl is the one-time Supabase recovery link. The signup
      // page redirects directly to this after payment so the contractor
      // lands on /reset-password.html with a valid session and can set
      // their password immediately — no email round-trip needed for the
      // happy path. The same URL is also emailed via WF5 as a backup
      // for contractors who close the tab before setting a password.
      passwordResetUrl: passwordResetUrl,
      loginUrl: 'https://www.selectservicepros.com/contractor-login.html'
    });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
