// Retired shared-password config endpoint. SSP operations now use authenticated
// admin APIs; taxonomy/pricing changes are versioned migrations.
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(410).json({ ok:false, error:"retired_endpoint" });
};