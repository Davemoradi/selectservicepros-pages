// /api/create-bd-account.js
// Creates a Brilliant Directories member account via API
// BD API requires Content-Type: application/x-www-form-urlencoded (NOT JSON)

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
      return res.status(400).json({ error: 'Missing required fields: email, firstName, lastName' });
    }

    const subscriptionId = PLAN_MAP[planName] || 1;

    // Generate a random password
    const password = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4).toUpperCase();

    // BD API requires application/x-www-form-urlencoded
    const params = new URLSearchParams();
    params.append('email', email);
    params.append('password', password);
    params.append('subscription_id', subscriptionId.toString());
    params.append('first_name', firstName);
    params.append('last_name', lastName);
    params.append('phone', phone || '');
    params.append('company', companyName || '');
    params.append('description', businessDescription || '');
    params.append('website', websiteUrl || '');
    params.append('listing_type', 'Company');
    params.append('status', '1');
    params.append('send_signup_email', '1');

    if (services) params.append('services', services);
    if (licenseNumber) params.append('license_number', licenseNumber);

    console.log('Creating BD account for:', email, 'Plan:', planName, 'Sub ID:', subscriptionId);

    const bdResponse = await fetch(BD_DOMAIN + '/api/v2/user/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Api-Key': BD_API_KEY,
        'accept': 'application/json'
      },
      body: params.toString()
    });

    const bdText = await bdResponse.text();
    console.log('BD API response status:', bdResponse.status);
    console.log('BD API response:', bdText.substring(0, 500));

    let bdData;
    try {
      bdData = JSON.parse(bdText);
    } catch (e) {
      console.error('BD API returned non-JSON:', bdText.substring(0, 200));
      return res.status(500).json({
        error: 'BD API returned invalid response',
        details: bdText.substring(0, 200)
      });
    }

    if (bdData.status === 'error' || bdData.error) {
      console.error('BD API error:', JSON.stringify(bdData));
      return res.status(500).json({
        error: 'Failed to create directory account',
        details: bdData.message || bdData.error || 'Unknown BD error'
      });
    }

    console.log('BD account created successfully for:', email);

    res.status(200).json({
      success: true,
      message: 'Account created successfully',
      loginUrl: BD_DOMAIN + '/login',
      email: email,
      tempPassword: password
    });

  } catch (err) {
    console.error('BD account creation error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
