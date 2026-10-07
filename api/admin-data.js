// api/admin-data.js — authenticated SSP operations snapshot. No shared password.
const { requireAdmin } = require("./_admin-auth");

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "GET") return res.status(405).json({ ok:false, error:"method_not_allowed" });

  let ctx;
  try { ctx = await requireAdmin(req); }
  catch (e) { return res.status(e.status || 500).json({ ok:false, error:e.message || "admin_auth_failed" }); }
  const { supabase, user } = ctx;

  try {
    const [contractorsR, licensesR, leadsR, offersR, walletR, pricingR, disputesR] = await Promise.all([
      supabase.from("contractors")
        .select("id,email,first_name,last_name,company_name,phone,status,service_categories,service_zips,promo_credits_cents,lead_balance_cents,insurance_verified,insurance_expiration,insurance_doc_url,created_at")
        .order("created_at", { ascending:false }),
      supabase.from("contractor_licenses")
        .select("id,contractor_id,trade_category,license_type,license_state,license_number,expiration_date,document_url,verified,verified_at")
        .order("created_at", { ascending:false }),
      supabase.from("leads")
        .select("id,created_at,homeowner_name,homeowner_phone,homeowner_email,homeowner_zip,service_category,service_type,issue_code,urgency,status,pricing_version,pricing_band,price_cents,matching_expires_at")
        .order("created_at", { ascending:false }).limit(250),
      supabase.from("lead_offers")
        .select("id,lead_id,contractor_id,status,price_cents,offered_at,expires_at,responded_at,transaction_id")
        .order("offered_at", { ascending:false }).limit(1000),
      supabase.from("wallet_transactions")
        .select("id,contractor_id,type,amount_cents,promo_delta_cents,paid_delta_cents,lead_id,description,created_by,idempotency_key,created_at")
        .order("created_at", { ascending:false }).limit(2000),
      supabase.from("band_map")
        .select("version,category,issue_code,label,band,price_cents,requires_clarification")
        .eq("version","v1").order("category", { ascending:true }),
      supabase.from("lead_disputes")
        .select("id,contractor_id,lead_id,debit_transaction_id,reason,evidence,submitted_at,decided_at,decision,decided_by,restored_promo_cents,restored_paid_cents,reversal_transaction_id")
        .order("submitted_at", { ascending:false }).limit(250),
    ]);

    for (const [name, r] of Object.entries({contractorsR,licensesR,leadsR,offersR,walletR,pricingR})) {
      if (r.error) throw new Error(`${name}:${r.error.message}`);
    }
    // lead_disputes may not exist until the core migration is present. Keep the
    // rest of operations usable and surface an empty queue instead of 500.
    const disputes = disputesR.error ? [] : (disputesR.data || []);

    const contractors = contractorsR.data || [];
    const licenses = licensesR.data || [];
    const leads = leadsR.data || [];
    const offers = offersR.data || [];
    const wallet = walletR.data || [];
    const pricing = pricingR.data || [];

    const licenseByContractor = new Map();
    for (const l of licenses) {
      if (!licenseByContractor.has(l.contractor_id)) licenseByContractor.set(l.contractor_id, []);
      licenseByContractor.get(l.contractor_id).push(l);
    }

    const contractorsOut = contractors.map((c) => ({
      ...c,
      licenses: licenseByContractor.get(c.id) || [],
    }));

    const acceptedOffers = offers.filter((o) => o.status === "accepted");
    const leadCharges = wallet.filter((t) => t.type === "lead_charge");
    const topups = wallet.filter((t) => t.type === "topup");
    const promoGrants = wallet.filter((t) => t.type === "promo_grant");
    const founding25Grants = promoGrants.filter((t) => String(t.idempotency_key || "").startsWith("founding25:v1:"));

    return res.status(200).json({
      ok: true,
      admin: { email: user.email || null },
      contractors: contractorsOut,
      leads,
      offers,
      wallet_transactions: wallet,
      pricing,
      disputes,
      stats: {
        contractors_total: contractors.length,
        contractors_active: contractors.filter((c) => c.status === "Active").length,
        contractors_pending_review: contractors.filter((c) => c.status === "Pending Review").length,
        leads_total_loaded: leads.length,
        leads_offering: leads.filter((l) => l.status === "Offering").length,
        leads_matched: leads.filter((l) => l.status === "Matched").length,
        leads_unmatched: leads.filter((l) => l.status === "Unmatched").length,
        accepted_offers: acceptedOffers.length,
        paid_wallet_cents: contractors.reduce((n,c) => n + Number(c.lead_balance_cents || 0), 0),
        promo_wallet_cents: contractors.reduce((n,c) => n + Number(c.promo_credits_cents || 0), 0),
        lead_charge_cents: leadCharges.reduce((n,t) => n + Math.abs(Number(t.amount_cents || 0)), 0),
        stripe_topup_cents: topups.reduce((n,t) => n + Math.max(0, Number(t.amount_cents || 0)), 0),
        promo_grant_cents: promoGrants.reduce((n,t) => n + Math.max(0, Number(t.amount_cents || 0)), 0),
        founding25_grants: founding25Grants.length,
        pricing_rows: pricing.length,
        pricing_held: pricing.filter((r) => r.requires_clarification).length,
        disputes_open: disputes.filter((d) => !d.decision).length,
      },
    });
  } catch (err) {
    console.error("admin-data:", err && err.message);
    return res.status(500).json({ ok:false, error:"admin_data_failed" });
  }
};