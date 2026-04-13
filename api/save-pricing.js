const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  var action = req.body.action;

  // READ pricing — no password needed (contractors read this)
  if (action === 'read') {
    try {
      var result = await supabase.from('platform_config').select('value').eq('key', 'pricing').single();
      if (result.error || !result.data) {
        return res.status(200).json({
          success: true,
          pricing: {
            basic: { monthly: 49, perLead: 39, window: 30 },
            pro: { monthly: 99, perLead: 29, window: 45 },
            elite: { monthly: 199, perLead: 19, window: 60 }
          }
        });
      }
      return res.status(200).json({ success: true, pricing: result.data.value });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // WRITE pricing — password required (admin only)
  if (action === 'write') {
    if (req.body.password !== 'ssp2025') {
      return res.status(401).json({ error: 'Invalid password' });
    }
    var pricing = req.body.pricing;
    if (!pricing) return res.status(400).json({ error: 'Missing pricing data' });

    try {
      var result = await supabase.from('platform_config')
        .update({ value: pricing, updated_at: new Date().toISOString() })
        .eq('key', 'pricing');

      if (result.error) {
        // Row might not exist yet — try insert
        var insertResult = await supabase.from('platform_config')
          .insert({ key: 'pricing', value: pricing });
        if (insertResult.error) return res.status(500).json({ error: insertResult.error.message });
      }

      return res.status(200).json({ success: true, message: 'Pricing saved' });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'Invalid action. Use "read" or "write"' });
};
