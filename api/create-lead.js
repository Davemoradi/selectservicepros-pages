const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://kasqtxwbsmjlisbnebku.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imthc3F0eHdic21qbGlzYm5lYmt1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MzkxODgsImV4cCI6MjA5MTQxNTE4OH0.QEiRMQYZlOEgk1FzOV-L3TMRjgC046ymziSE7RNO8Yg";

const GHL_WEBHOOK =
  "https://services.leadconnectorhq.com/hooks/QfDToN545k1TOpFZa5AQ/webhook-trigger/a65106d8-9948-4122-9364-bddcc07aca5c";
const CONTRACTOR_NOTIFY_WEBHOOK =
  "https://services.leadconnectorhq.com/hooks/QfDToN545k1TOpFZa5AQ/webhook-trigger/jhKITwxqbN20tY3x5BqS";
const HOMEOWNER_NOTIFY_WEBHOOK =
  "https://services.leadconnectorhq.com/hooks/QfDToN545k1TOpFZa5AQ/webhook-trigger/c8b7ef11-035b-4266-9334-6043c1424208";



// Tier priority for matching (highest priority first)
const TIER_PRIORITY = { Elite: 1, Pro: 2, Basic: 3 };

// Minutes each tier has to claim a lead before it's offered to the next tier.
// Used in Email 4 ("expires in N minutes") and in the dashboard lead timer.
// Must match what the Tiered Lead Expiry GHL workflow uses.
var TIER_RESPONSE_WINDOW = { Elite: 60, Pro: 45, Basic: 30 };

// Pull the first word from a full name field so branded emails can greet
// the homeowner by first name without needing a separate intake field.
function firstNameOf(full) {
  if (!full) return "";
  var s = String(full).trim();
  if (!s) return "";
  return s.split(/\s+/)[0];
}

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

// --- Helper: build address field object from request body ---
// Safely extracts structured address fields (all optional) from the form payload.
// Returns only keys with defined values so we don't accidentally overwrite
// existing columns with null on an UPDATE.
function extractAddressFields(body) {
  var out = {};
  if (body.address !== undefined) out.homeowner_address = (body.address || "").trim() || null;
  if (body.street !== undefined) out.homeowner_street = (body.street || "").trim() || null;
  if (body.city !== undefined) out.homeowner_city = (body.city || "").trim() || null;
  if (body.state_region !== undefined) out.homeowner_state = (body.state_region || "").trim() || null;
  if (body.lat !== undefined && body.lat !== null && body.lat !== "")
    out.homeowner_lat = Number(body.lat);
  if (body.lng !== undefined && body.lng !== null && body.lng !== "")
    out.homeowner_lng = Number(body.lng);
  if (body.place_id !== undefined) out.place_id = (body.place_id || "").trim() || null;
  return out;
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

    // NEW: partial / leadId routing
    var isPartial = body.partial === true;
    var leadIdFromBody = (body.leadId || "").trim();

    // Supabase client (used by all branches)
    var supabaseKey = SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY;
    var supabase = createClient(SUPABASE_URL, supabaseKey);

    // ============================================================
    // CASE A: Partial capture (Step 2 submission)
    // ============================================================
    // Minimum data check: need at least name + phone + zip to store anything useful.
    // Email is not strictly required for a partial - some users may skip it.
    if (isPartial) {
      if (!name || !phone || !zip) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields for partial capture: name, phone, zip",
        });
      }

      var partialData = Object.assign({
        homeowner_name: name,
        homeowner_phone: phone,
        homeowner_email: email || null,
        homeowner_zip: zip,
        service_category: category || null,
        // Issue/urgency/details come at Step 4 - leave null/placeholder
        service_type: service || null,
        urgency: null,
        description: null,
        status: "Partial",
        partial: true,
        source: "website",
        paid: false,
      }, extractAddressFields(body));

      var partialResult = await supabase
        .from("leads")
        .insert([partialData])
        .select("id")
        .single();

      if (partialResult.error) {
        console.error("Partial lead insert error:", partialResult.error);
        return res.status(500).json({
          success: false,
          error: "Failed to save partial lead: " + partialResult.error.message,
        });
      }

      return res.status(200).json({
        success: true,
        leadId: partialResult.data.id,
        partial: true,
        message: "Partial lead saved. Continue to finish the request.",
      });
    }

    // ============================================================
    // From here on: FINAL submission (partial=false or absent).
    // Either Case B (has leadId, UPDATE existing partial) or
    // Case C (no leadId, INSERT new row - legacy/direct submission).
    // ============================================================

    // Validate required fields for final submission
    if (!name || !phone || !zip || !service) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: name, phone, zip, service",
      });
    }

    var urgencyLabel = mapUrgency(urgency);

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
    // SELECT includes the fields needed for lead-notification (Email 4) and
    // homeowner-matched (Email 6) email templates. Adding fields here once
    // means every downstream webhook payload can include them without extra
    // DB round-trips.
    var contractorsResult = await supabase
      .from("contractors")
      .select(
        "id, first_name, last_name, email, phone, company_name, membership_tier, service_categories, service_zips, status, business_description, years_in_business"
      )
      .in("status", ["Active"]);

    var allContractors = contractorsResult.data || [];

    var matches = allContractors.filter(function (c) {
      var cats = c.service_categories || "";
      var zips = c.service_zips || "";

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

    matches.sort(function (a, b) {
      var aPriority = TIER_PRIORITY[a.membership_tier] || 99;
      var bPriority = TIER_PRIORITY[b.membership_tier] || 99;
      return aPriority - bPriority;
    });

    var assignedContractor = matches.length > 0 ? matches[0] : null;
    var leadStatus = assignedContractor ? "New" : "Unmatched";

    var leadFee = 0;
    if (assignedContractor) {
      var tier = assignedContractor.membership_tier || "Basic";
      var tierPricing = pricing[tier] || pricing.Basic || defaultPricing.Basic;
      leadFee = tierPricing.perLead || 0;
    }

    // Fields shared by both insert & update paths
    var finalFields = Object.assign({
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
      partial: false, // Always flip to false on final submission
    }, extractAddressFields(body));

    var leadId = null;
    var leadRowUsedUpdate = false;

    // ============================================================
    // CASE B: UPDATE existing partial row (dedup path)
    // ============================================================
    if (leadIdFromBody) {
      // Verify the referenced lead exists
      var existingResult = await supabase
        .from("leads")
        .select("id, partial")
        .eq("id", leadIdFromBody)
        .single();

      if (existingResult.data && existingResult.data.id) {
        // Row exists - update it in place
        var updateResult = await supabase
          .from("leads")
          .update(finalFields)
          .eq("id", leadIdFromBody)
          .select("id")
          .single();

        if (updateResult.error) {
          console.error("Lead update error (will fall back to insert):", updateResult.error);
          // Fall through to INSERT path below - never lose a lead
        } else {
          leadId = updateResult.data.id;
          leadRowUsedUpdate = true;
        }
      } else {
        // leadId provided but row not found - likely deleted or mangled.
        // Fall back to Case C: insert a new row so we never lose the lead.
        console.log("leadId " + leadIdFromBody + " not found - falling back to new insert");
      }
    }

    // ============================================================
    // CASE C: INSERT new row (no leadId, or Case B fallback)
    // ============================================================
    if (!leadId) {
      var insertResult = await supabase
        .from("leads")
        .insert([finalFields])
        .select("id")
        .single();

      if (insertResult.error) {
        console.error("Supabase lead insert error:", insertResult.error);
        return res.status(500).json({
          success: false,
          error: "Failed to create lead: " + insertResult.error.message,
        });
      }
      leadId = insertResult.data.id;
    }

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
          address: body.address || "",
          city: body.city || "",
          state: body.state_region || "",
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
          updated_from_partial: leadRowUsedUpdate,
        }),
      });
    } catch (ghlError) {
      console.error("GHL webhook error (non-fatal):", ghlError.message);
    }

    // --- Notify contractor of new lead ---
    // Payload feeds GHL's "New Lead Notification" workflow → Email 4.
    // Every placeholder in that template must be covered here.
    if (assignedContractor && assignedContractor.email) {
      try {
        var contractorTier = assignedContractor.membership_tier || "Basic";
        await fetch(CONTRACTOR_NOTIFY_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "contractor_notification",
            contractor_name:
              (assignedContractor.first_name || "") +
              " " +
              (assignedContractor.last_name || ""),
            contractor_first_name: assignedContractor.first_name || "",
            contractor_email: assignedContractor.email,
            contractor_phone: assignedContractor.phone || "",
            contractor_company: assignedContractor.company_name || "",
            contractor_id: assignedContractor.id,
            contractor_tier: contractorTier,
            lead_id: leadId,
            homeowner_name: name,
            homeowner_first_name: firstNameOf(name),
            homeowner_zip: zip,
            homeowner_address: body.address || "",
            service_type: service,
            service_category: category,
            urgency: urgencyLabel,
            details: details,
            lead_fee: leadFee,
            response_window_minutes: TIER_RESPONSE_WINDOW[contractorTier] || 30,
            accept_url: "https://www.selectservicepros.com/contractor-dashboard.html?tab=leads&lead=" + leadId + "&action=accept",
            dashboard_url: "https://www.selectservicepros.com/contractor-dashboard.html",
          }),
        });
      } catch (notifyError) {
        console.error("Contractor notification error (non-fatal):", notifyError.message);
      }
    }

    // --- Notify homeowner of lead received ---
    // Payload drives TWO GHL workflows:
    //   - "homeowner_confirmation" (Email 5): always fires
    //   - "homeowner_matched"      (Email 6): GHL filters when matched=true
    //     AND contractor_company is populated
    // Both templates get everything they need from this single payload.
    if (email) {
      try {
        await fetch(HOMEOWNER_NOTIFY_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "homeowner_confirmation",
            homeowner_name: name,
            homeowner_first_name: firstNameOf(name),
            homeowner_email: email,
            homeowner_phone: phone,
            homeowner_zip: zip,
            homeowner_address: body.address || "",
            service_type: service,
            service_category: category,
            urgency: urgencyLabel,
            details: details,
            matched: !!assignedContractor,
            // Contractor fields — present only when matched. Email 6
            // template uses these; Email 5 ignores them. GHL filter on
            // contractor_company presence keeps Email 6 from firing on
            // unmatched leads.
            contractor_name: assignedContractor
              ? (assignedContractor.first_name || "") + " " + (assignedContractor.last_name || "")
              : "",
            contractor_first_name: assignedContractor ? (assignedContractor.first_name || "") : "",
            contractor_company: assignedContractor ? (assignedContractor.company_name || "") : "",
            contractor_phone: assignedContractor ? (assignedContractor.phone || "") : "",
            contractor_email: assignedContractor ? (assignedContractor.email || "") : "",
            years_in_business: assignedContractor ? (assignedContractor.years_in_business || "") : "",
            business_description: assignedContractor ? (assignedContractor.business_description || "") : "",
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
      updatedFromPartial: leadRowUsedUpdate,
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
