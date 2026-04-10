// /api/create-bd-account.js
// Creates a Brilliant Directories member account via API
// Called from contractor-signup.html Step 3 after profile form submission

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const BD_API_KEY = process.env.BD_API_KEY;
  const BD_DOMAIN = 'https://contractors.selectservicepros.com';

  // Map Stripe plan names to BD subscription IDs
  const PLAN_MAP = {
    'Basic': 1,
    'Pro': 2,
    'Elite': 3
  };

  try {
    const {
      email,
      firstName,
      lastName,
      phone,
      companyName,
      planName,
      businessDescription,
      yearsInBusiness,
      licenseNumber,
      serviceZips,
      websiteUrl,
      services,
      categories
    } = req.body;

    if (!email || !firstName || !lastName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const subscriptionId = PLAN_MAP[planName] || 1;

    // Generate a random 8-char password
    const password = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4).toUpperCase();

    // Create member via BD API
    const bdPayload = {
      email: email,
      password: password,
      subscription_id: subscriptionId,
      first_name: firstName,
      last_name: lastName,
      phone: phone,
      company: companyName || '',
      description: businessDescription || '',
      website: websiteUrl || '',
      send_signup_email: 1,
      status: 1 // Active
    };

    const bdResponse = await fetch(`${BD_DOMAIN}/api/v2/user/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': BD_API_KEY
      },
      body: JSON.stringify(bdPayload)
    });

    const bdData = await bdResponse.json();

    if (!bdResponse.ok) {
      console.error('BD API error:', bdData);
      return res.status(500).json({
        error: 'Failed to create directory account',
        details: bdData.message || bdData.error || 'Unknown BD error'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Account created successfully',
      loginUrl: `${BD_DOMAIN}/login`,
      email: email
    });

  } catch (err) {
    console.error('BD account creation error:', err);
    res.status(500).json({ error: err.message });
  }
};
