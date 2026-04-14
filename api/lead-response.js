const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://kasqtxwbsmjlisbnebku.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const GHL_WEBHOOK =
  "https://services.leadconnectorhq.com/hooks/QfDToN545k1TOpFZa5AQ/webhook-trigger/a65106d8-9948-4122-9364-bddcc07aca5c";

module.exports = async function handler(req, res) {
  var params = req.method === "GET" ? req.query : req.body || {};
  var action = (params.action || "").toLowerCase();
  var leadId = params.leadId || "";
  var contractorId = params.contractorId || "";

  if (!action || !leadId || !contractorId) {
    return res.status(400).send(buildPage("Missing Information", "This link is invalid or has expired.", "error"));
  }
  if (action !== "accept" && action !== "pass") {
    return res.status(400).send(buildPage("Invalid Action", "The action must be either accept or pass.", "error"));
  }

  try {
    var supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    var leadResult = await supabase.from("leads").select("*").eq("id", leadId).single();
    if (leadResult.error || !leadResult.data) {
      return res.status(404).send(buildPage("Lead Not Found", "This lead no longer exists.", "error"));
    }
    var lead = leadResult.data;

    if (lead.status !== "New") {
      return res.status(400).send(buildPage("Already Responded", "This lead has already been " + lead.status.toLowerCase() + ".", "info"));
    }
    if (lead.assigned_contractor_id !== contractorId) {
      return res.status(403).send(buildPage("Not Authorized", "You are not assigned to this lead.", "error"));
    }

    var contractorResult = await supabase.from("contractors").select("first_name, last_name, email, membership_tier").eq("id", contractorId).single();
    var contractor = contractorResult.data || {};
    var contractorName = ((contractor.first_name || "") + " " + (contractor.last_name || "")).trim();
    var now = new Date().toISOString();
    var deliveredAt = lead.delivered_at ? new Date(lead.delivered_at) : null;
    var responseSeconds = deliveredAt ? Math.round((new Date() - deliveredAt) / 1000) : null;

    if (action === "accept") {
      await supabase.from("leads").update({ status: "Accepted", accepted_at: now, responded_at: now, response_time_seconds: responseSeconds }).eq("id", leadId);

      try {
        await fetch(GHL_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "lead_accepted", lead_id: leadId, contractor_name: contractorName, contractor_email: contractor.email,
            contractor_tier: contractor.membership_tier, homeowner_name: lead.homeowner_name, homeowner_phone: lead.homeowner_phone,
            homeowner_email: lead.homeowner_email, homeowner_zip: lead.homeowner_zip, service_type: lead.service_type,
            urgency: lead.urgency, lead_fee: lead.lead_fee
          })
        });
      } catch (e) { console.error("GHL notify error:", e.message); }

      return res.status(200).send(buildPage("Lead Accepted!",
        "You accepted the " + (lead.service_type || "service") + " lead in ZIP " + (lead.homeowner_zip || "") + ".<br><br>" +
        "<strong>Homeowner:</strong> " + (lead.homeowner_name || "") + "<br>" +
        "<strong>Phone:</strong> " + (lead.homeowner_phone || "") + "<br>" +
        "<strong>Email:</strong> " + (lead.homeowner_email || "") + "<br><br>" +
        "Lead fee: <strong>$" + (lead.lead_fee || 0) + "</strong><br><br>Please contact the homeowner ASAP.", "success"));

    } else {
      await supabase.from("leads").update({ status: "Passed", responded_at: now, response_time_seconds: responseSeconds }).eq("id", leadId);

      try {
        await fetch(GHL_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "lead_passed", lead_id: leadId, contractor_name: contractorName, contractor_email: contractor.email,
            homeowner_name: lead.homeowner_name, service_type: lead.service_type, homeowner_zip: lead.homeowner_zip
          })
        });
      } catch (e) { console.error("GHL notify error:", e.message); }

      return res.status(200).send(buildPage("Lead Passed",
        "You passed on the " + (lead.service_type || "service") + " lead in ZIP " + (lead.homeowner_zip || "") + ".<br><br>No fee will be charged.", "info"));
    }
  } catch (err) {
    console.error("lead-response error:", err);
    return res.status(500).send(buildPage("Something Went Wrong", "Please try again or log in to your dashboard.", "error"));
  }
};

function buildPage(title, message, type) {
  var color = type === "success" ? "#22c55e" : type === "error" ? "#ef4444" : "#f05528";
  var icon = type === "success" ? "&#10003;" : type === "error" ? "&#10007;" : "&#8505;";
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + title + ' \u2014 SelectServicePros</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">' +
    '<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:"DM Sans",sans-serif;background:#fef6f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}' +
    '.card{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:500px;width:100%;padding:48px 40px;text-align:center}' +
    '.icon{width:64px;height:64px;border-radius:50%;background:' + color + ';color:#fff;font-size:28px;display:flex;align-items:center;justify-content:center;margin:0 auto 24px}' +
    'h1{font-size:24px;font-weight:700;color:#0c2340;margin-bottom:16px}' +
    '.msg{font-size:15px;color:#555;line-height:1.6;margin-bottom:32px}' +
    '.btn{display:inline-block;padding:12px 32px;background:#f05528;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px}.btn:hover{background:#d4451e}' +
    '</style></head><body><div class="card"><div class="icon">' + icon + '</div>' +
    '<h1>' + title + '</h1><div class="msg">' + message + '</div>' +
    '<a href="https://www.selectservicepros.com/contractor-dashboard.html" class="btn">Go to Dashboard</a></div></body></html>';
}