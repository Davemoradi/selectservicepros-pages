// Retired tier-pricing endpoint. Pricing is versioned in public.band_map and
// changed only through reviewed database migrations.
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(410).json({ ok:false, error:"retired_endpoint" });
};