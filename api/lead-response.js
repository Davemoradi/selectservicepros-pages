// Retired insecure single-assignee response endpoint.
// Contractors must authenticate and use /api/lead-accept or /api/lead-decline.
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(410).json({
    ok: false,
    error: "retired_endpoint",
    message: "Use the authenticated contractor dashboard for lead responses."
  });
};