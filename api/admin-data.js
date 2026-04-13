const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var password = req.body.password;
  if (password !== 'ssp2025') {
    return res.status(401).json({ error: 'Invalid password' });
  }

  var supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  try {
    var contractorsResult = await supabase.from('contractors')
      .select('id, email, first_name, last_name, company_name, phone, membership_tier, status, services, service_categories, service_zips, lead_count, acceptance_rate, avg_response_time, total_lead_charges, created_at')
      .order('created_at', { ascending: false });

    var leadsResult = await supabase.from('leads')
      .select('id, created_at, homeowner_name, homeowner_phone, homeowner_email, homeowner_zip, service_type, service_category, description, urgency, status, assigned_contractor_id, accepted_at, lead_fee, paid, response_time_seconds')
      .order('created_at', { ascending: false })
      .limit(100);

    var contractors = contractorsResult.data || [];
    var leads = leadsResult.data || [];

    var totalMRR = contractors.reduce(function(sum, c) {
      var prices = { Basic: 49, Pro: 99, Elite: 199 };
      return sum + (prices[c.membership_tier] || 0);
    }, 0);

    var totalLeadCharges = leads.filter(function(l) {
      return l.status === 'Accepted' && l.lead_fee;
    }).reduce(function(sum, l) { return sum + (parseFloat(l.lead_fee) || 0); }, 0);

    return res.status(200).json({
      success: true,
      contractors: contractors,
      leads: leads,
      stats: {
        totalContractors: contractors.length,
        totalLeads: leads.length,
        totalMRR: totalMRR,
        totalLeadCharges: totalLeadCharges,
        totalRevenue: totalMRR + totalLeadCharges
      }
    });
  } catch (err) {
    console.error('Admin data error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
