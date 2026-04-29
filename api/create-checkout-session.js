// /api/create-checkout-session.js
// Vercel serverless function — creates a Stripe Checkout Session in embedded mode
// Requires STRIPE_SECRET_KEY environment variable set in Vercel dashboard

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Plan config — prices in cents
const PLANS = {
  // Prices in cents. Must match ssp-config.js and platform_config.pricing.
  // Source of truth: platform_config.pricing in Supabase. Verified 2026-04-22.
  basic: { name: 'Basic Membership', price: 4900,  interval: 'month' },  // $49/mo
  pro:   { name: 'Pro Membership',   price: 9900,  interval: 'month' },  // $99/mo
  elite: { name: 'Elite Membership', price: 19900, interval: 'month' },  // $199/mo
};

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { planId, email, name, phone, companyName } = req.body;

    const plan = PLANS[planId];
    if (!plan) {
      return res.status(400).json({ error: 'Invalid plan' });
    }

    // Reuse the existing Stripe customer if this email has paid before.
    // Without this, an abandoned checkout + retry creates a duplicate
    // customer; the webhook (which matches contractors by email) then
    // overwrites stripe_customer_id with the newer customer's ID,
    // orphaning the first.
    let existingCustomerId = null;
    if (email) {
      try {
        const existing = await stripe.customers.list({ email: email, limit: 1 });
        existingCustomerId = existing.data[0]?.id || null;
      } catch (lookupErr) {
        console.warn('Stripe customer lookup failed, falling back:', lookupErr.message);
      }
    }

    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded',
      mode: 'subscription',
      ...(existingCustomerId ? { customer: existingCustomerId } : { customer_email: email }),
      metadata: {
        contractor_name: name,
        contractor_phone: phone,
        contractor_company: companyName,
        plan_id: planId,
      },
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: plan.name,
              description: `Select Service Pros — ${plan.name}`,
            },
            unit_amount: plan.price,
            recurring: { interval: plan.interval },
          },
          quantity: 1,
        },
      ],
      return_url: `${req.headers.origin || 'https://www.selectservicepros.com'}/contractor-signup.html#success&session_id={CHECKOUT_SESSION_ID}`,
    });

    res.status(200).json({ clientSecret: session.client_secret });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).json({ error: err.message });
  }
};
