const { createClient } = require('@supabase/supabase-js');

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
    // 1. Create Supabase auth user with auto-confirm and random password
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

    // 2. Insert contractor profile into contractors table
    const { error: insertError } = await supabase.from('contractors').insert({
      auth_id: authId,
      email: email,
      first_name: firstName,
      last_name: lastName,
      phone: phone || null,
      company_name: companyName || null,
      plan: planName || 'Basic',
      business_description: businessDescription || null,
      years_in_business: yearsInBusiness || null,
      num_employees: numEmployees || null,
      license_number: licenseNumber || null,
      license_type: licenseType || null,
      service_zips: serviceZips || null,
      services: services || null,
      service_categories: serviceCategories || null,
      website_url: websiteUrl || null,
      status: 'Paid',
      lead_count: 0,
      acceptance_rate: 0
    });

    if (insertError) {
      console.error('Insert error:', insertError.message);
      // Don't fail completely — auth user was created
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
      contractor_status: 'Paid',
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
      loginUrl: 'https://www.selectservicepros.com/contractor-login.html'
    });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
