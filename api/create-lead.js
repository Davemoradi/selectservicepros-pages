const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://kasqtxwbsmjlisbnebku.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imthc3F0eHdic21qbGlzYm5lYmt1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MzkxODgsImV4cCI6MjA5MTQxNTE4OH0.QEiRMQYZlOEgk1FzOV-L3TMRjgC046ymziSE7RNO8Yg";

const GHL_WEBHOOK =
  "https://services.leadconnectorhq.com/hooks/a65106d8-9948-4122-9364-bddcc07aca5c";
const CONTRACTOR_NOTIFY_WEBHOOK =
  "https://services.leadconnectorhq.com/hooks/QfDToN545k1TOpFZa5AQ/webhook-trigger/jhKITwxqbN20tY3x5BqS";
const HOMEOWNER_NOTIFY_WEBHOOK =
  "https://services.leadconnectorhq.com/hooks/QfDToN545k1TOpFZa5AQ/webhook-trigger/1nnmq9KJX7CzZI0tlYIw";



// Tier priority for matching (highest priority first)
const TIER_PRIORITY = { Elite: 1, Pro: 2, Basic: 3 };

// Map urgency input to label
function mapUrgency(input) {
  if (!input) return "Planning";
  var lower = input.toLowerCase();
  if (lower.indexOf("emergency") !== -1 || lower.indexOf("urgent") !== -1 || lower === "asap")
    return "Emergency";
  if (lower.indexOf("soon") !== -1 || lower.indexOf("week") !== -1 || lower.indexOf("few days") !== -1)
    return "Soon";
  return "Planning";
}

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    var body = req.body || {};
    var name = (body.name || "").trim();
    var phone = (body.phone || "").trim();
    var email = (body.email || "").trim();
    var zip = (body.zip || "").trim();
    var service = (body.service || "").trim();
    var category = (body.category || "").trim();
    var urgency = body.urgency || "";
    var details = (body.details || "").trim();

    // Validate required fields
    if (!name || !phone || !zip || !service) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: name, phone, zip, service",
      });
    }

    var urgencyLabel = mapUrgency(urgency);

    // Use service role key for full access, fall back to anon key
    var supabaseKey = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
    var supabase = createClient(SUPABASE_URL, supabaseKey);

    // --- Load pricing from platform_config ---
    var defaultPricing = {
      Basic: { monthly: 49, perLead: 39, responseWindow: 30 },
      Pro: { monthly: 99, perLead: 29, responseWindow: 45 },
      Elite: { monthly: 199, perLead: 19, responseWindow: 60 },
    };

    var pricing = defaultPricing;
    try {
      var configResult = await supabase
        .from("platform_config")
        .select("value")
        .eq("key", "pricing")
        .single();
      if (configResult.data && configResult.data.value) {
        pricing = configResult.data.value;
      }
    } catch (e) {
      console.log("Using default pricing, config fetch failed:", e.message);
    }

    // --- Find matching contractors ---
    // Fetch all contractors who are paid/verified
    var contractorsResult = await supabase
      .from("contractors")
      .select(
        "id, first_name, last_name, email, membership_tier, service_categories, service_zips, status"
      )
      .in("status", ["Paid"]);

    var allContractors = contractorsResult.data || [];

    // Filter: contractor's service_categories must contain the category,
    // AND contractor's service_zips must contain the zip
    var matches = allContractors.filter(function (c) {
      var cats = c.service_categories || "";
      var zips = c.service_zips || "";

      // Handle both string and array formats
      var catMatch = false;
      if (category) {
        if (typeof cats === "string") {
          catMatch = cats.toLowerCase().indexOf(category.toLowerCase()) !== -1;
        } else if (Array.isArray(cats)) {
          catMatch = cats.some(function (cat) {
            return cat.toLowerCase() === category.toLowerCase();
          });
        }
      } else {
        // No category specified, match all
        catMatch = true;
      }

      var zipMatch = false;
      if (zip) {
        if (typeof zips === "string") {
          zipMatch = zips.indexOf(zip) !== -1;
        } else if (Array.isArray(zips)) {
          zipMatch = zips.indexOf(zip) !== -1;
        }
      }

      return catMatch && zipMatch;
    });

    // Sort by tier priority: Elite first, then Pro, then Basic
    matches.sort(function (a, b) {
      var aPriority = TIER_PRIORITY[a.membership_tier] || 99;
      var bPriority = TIER_PRIORITY[b.membership_tier] || 99;
      return aPriority - bPriority;
    });

    // Assign to top matching contractor
    var assignedContractor = matches.length > 0 ? matches[0] : null;
    var leadStatus = assignedContractor ? "New" : "Unmatched";

    // Determine lead fee based on assigned contractor's tier
    var leadFee = 0;
    if (assignedContractor) {
      var tier = assignedContractor.membership_tier || "Basic";
      var tierPricing = pricing[tier] || pricing.Basic || defaultPricing.Basic;
      leadFee = tierPricing.perLead || 0;
    }

    // --- Create lead in Supabase ---
    var leadData = {
      homeowner_name: name,
      homeowner_phone: phone,
      homeowner_email: email || null,
      homeowner_zip: zip,
      service_type: service,
      service_category: category || null,
      description: details || null,
      urgency: urgencyLabel,
      status: leadStatus,
      assigned_contractor_id: assignedContractor ? assignedContractor.id : null,
      lead_fee: leadFee,
      paid: false,
      source: "website",
      delivered_at: assignedContractor ? new Date().toISOString() : null,
    };

    var leadResult = await supabase
      .from("leads")
      .insert([leadData])
      .select("id")
      .single();

    if (leadResult.error) {
      console.error("Supabase lead insert error:", leadResult.error);
      return res.status(500).json({
        success: false,
        error: "Failed to create lead: " + leadResult.error.message,
      });
    }

    var leadId = leadResult.data.id;

    // --- Send to GHL webhook for CRM tracking ---
    try {
      await fetch(GHL_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "new_lead",
          lead_id: leadId,
          name: name,
          phone: phone,
          email: email,
          zip: zip,
          service: service,
          category: category,
          urgency: urgencyLabel,
          details: details,
          matched: !!assignedContractor,
          contractor_name: assignedContractor
            ? (assignedContractor.first_name || "") +
              " " +
              (assignedContractor.last_name || "")
            : null,
          contractor_email: assignedContractor
            ? assignedContractor.email
            : null,
          lead_fee: leadFee,
        }),
      });
    } catch (ghlError) {
      // Don't fail the lead creation if GHL webhook fails
      console.error("GHL webhook error (non-fatal):", ghlError.message);
    }

    
    // --- Notify contractor of new lead ---
    if (assignedContractor && assignedContractor.email) {
      try {
        await fetch(CONTRACTOR_NOTIFY_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "contractor_notification",
            contractor_name:
              (assignedContractor.first_name || "") +
              " " +
              (assignedContractor.last_name || ""),
            contractor_email: assignedContractor.email,
            contractor_id: assignedContractor.id,
            contractor_tier: assignedContractor.membership_tier || "Basic",
            lead_id: leadId,
            homeowner_name: name,
            homeowner_zip: zip,
            service_type: service,
            service_category: category,
            urgency: urgencyLabel,
            details: details,
            lead_fee: leadFee,
          }),
        });
      } catch (notifyError) {
        console.error("Contractor notification error (non-fatal):", notifyError.message);
      }
    }

    
    // --- Notify homeowner of lead received ---
    if (email) {
      try {
        await fetch(HOMEOWNER_NOTIFY_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "homeowner_confirmation",
            homeowner_name: name,
            homeowner_email: email,
            homeowner_phone: phone,
            homeowner_zip: zip,
            service_type: service,
            service_category: category,
            urgency: urgencyLabel,
            details: details,
            matched: !!assignedContractor,
          }),
        });
      } catch (homeownerError) {
        console.error("Homeowner notification error (non-fatal):", homeownerError.message);
      }
    }

    // --- Return success ---
    return res.status(200).json({
      success: true,
      leadId: leadId,
      matched: !!assignedContractor,
      contractorCount: matches.length,
      message: assignedContractor
        ? "Lead created and matched to " +
          (assignedContractor.first_name || "") +
          " " +
          (assignedContractor.last_name || "")
        : "Lead created but no matching contractors found in your area. We'll follow up manually.",
    });
  } catch (err) {
    console.error("create-lead error:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
};
