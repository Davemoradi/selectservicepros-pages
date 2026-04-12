// /api/create-contractor.js
// Creates contractor in Supabase Auth + contractors table

const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.service_role;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    const {
      email, firstName, lastName, phone, companyName, planName,
      businessDescription, yearsInBusiness, numberOfEmployees,
      licenseNumber, licenseType, licenseVerified, licenseHolderName,
      licenseExpirationDate, licenseExpired,
      serviceZips, websiteUrl, services, categories, zip
    } = req.body;

    if (!email || !firstName || !lastName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log('Creating contractor:', email);

    // Random password — user will set their own via Reset Password on login page
    // GHL sends welcome email directing them to do this
    var tempPw = 'SSP_' + Math.random().toString(36).slice(2, 10) + Math.floor(Math.random() * 9000 + 1000);

    // 1. Create auth user — auto-confirmed so they can reset password immediately
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: email,
      password: tempPw,
      email_confirm: true,
      user_metadata: { first_name: firstName, last_name: lastName, role: 'contractor' }
    });

    if (authError) {
      console.error('Auth error:', authError.message);
      return res.status(500).json({ error: authError.message });
    }

    // 2. Insert contractor profile
    const { error: profileError } = await supabase.from('contractors').insert({
      auth_id: authData.user.id,
      email, first_name: firstName, last_name: lastName,
      phone: phone || null, company_name: companyName || null, zip_code: zip || null,
      services: services || null, service_categories: categories || null,
      service_zips: serviceZips || null, membership_tier: planName || 'Basic',
      business_description: businessDescription || null,
      years_in_business: yearsInBusiness || null,
      number_of_employees: numberOfEmployees || null,
      website_url: websiteUrl || null, license_number: licenseNumber || null,
      license_type: licenseType || null,
      license_verified: licenseVerified === 'Yes',
      license_holder_name: licenseHolderName || null,
      license_expiration_date: licenseExpirationDate || null,
      license_expired: licenseExpired === 'Yes',
      status: licenseVerified === 'Yes' ? 'Verified' : 'Pending Verification',
      onboarding_complete: true
    });

    if (profileError) console.error('Profile error:', profileError.message);
    else console.log('Contractor profile created:', email);

    console.log('Account created for:', email);
    res.status(200).json({
      success: true,
      message: 'Account created — check your email to set your password',
      loginUrl: 'https://www.selectservicepros.com/contractor-login.html'
    });

  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
