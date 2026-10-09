// api/create-lead.js
// Public homeowner intake endpoint for SSP's wallet / parallel-offer model.
//
// IMPORTANT:
// - Partial submissions are stored as Partial and never matched.
// - Final submissions snapshot immutable pricing from band_map v1.
// - Matching is delegated to fill_offer_slots(); this endpoint never selects a
//   contractor, never writes assigned_contractor_id, and never sends GHL.
// - A signed partial token prevents an arbitrary caller from overwriting an
//   existing lead merely by knowing its UUID.

const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://kasqtxwbsmjlisbnebku.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PARTIAL_SECRET = process.env.LEAD_PARTIAL_SECRET;
const RATE_LIMIT_SECRET = process.env.RATE_LIMIT_SECRET;
const PRICING_VERSION = "v1";
const MATCHING_WINDOW_MS = 60 * 60 * 1000;
const PARTIAL_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Shared Postgres-backed rate limiting. Raw identifiers are HMACed before
// storage so the limiter does not become a second PII store.
function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
  return req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : "unknown";
}

function rateKey(kind, raw) {
  return crypto.createHmac("sha256", RATE_LIMIT_SECRET)
    .update(`${kind}|${String(raw || "").trim().toLowerCase()}`)
    .digest("hex");
}

async function consumeLimit(supabase, scope, kind, raw, limit, windowSeconds) {
  const { data, error } = await supabase.rpc("consume_api_rate_limit", {
    p_scope: scope,
    p_key_hash: rateKey(kind, raw),
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error || !Array.isArray(data) || !data[0]) {
    console.error("create-lead: durable rate limiter failed", error || data);
    throw new Error("rate_limit_unavailable");
  }
  return data[0].allowed === true;
}

function clean(value, max) {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, max);
}

function digits(value) {
  return clean(value, 40).replace(/\D/g, "");
}

function validEmail(value) {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function validLatLng(lat, lng) {
  if (lat === null && lng === null) return true;
  if (lat === null || lng === null) return false;
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function mapUrgency(input) {
  const lower = clean(input, 80).toLowerCase();
  if (!lower) return "Planning";
  if (lower.includes("emergency") || lower.includes("urgent") || lower === "asap") return "Emergency";
  if (lower.includes("soon") || lower.includes("week") || lower.includes("few days")) return "Soon";
  return "Planning";
}

function addressFields(body) {
  const out = {};
  if (body.address !== undefined) out.homeowner_address = clean(body.address, 300) || null;
  if (body.street !== undefined) out.homeowner_street = clean(body.street, 200) || null;
  if (body.city !== undefined) out.homeowner_city = clean(body.city, 100) || null;
  if (body.state_region !== undefined) out.homeowner_state = clean(body.state_region, 50) || null;
  if (body.place_id !== undefined) out.place_id = clean(body.place_id, 250) || null;

  const lat = body.lat === "" || body.lat === undefined || body.lat === null ? null : Number(body.lat);
  const lng = body.lng === "" || body.lng === undefined || body.lng === null ? null : Number(body.lng);
  if (!validLatLng(lat, lng)) throw new Error("invalid_coordinates");
  if (lat !== null) out.homeowner_lat = lat;
  if (lng !== null) out.homeowner_lng = lng;
  return out;
}

function partialToken(leadId) {
  const ts = String(Date.now());
  const mac = crypto.createHmac("sha256", PARTIAL_SECRET).update(`${leadId}|${ts}`).digest("hex");
  return `${ts}.${mac}`;
}

function validPartialToken(leadId, token) {
  if (!UUID_RE.test(leadId || "") || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const ts = Number(parts[0]);
  const supplied = parts[1];
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > PARTIAL_TOKEN_MAX_AGE_MS) return false;
  if (!/^[0-9a-f]{64}$/i.test(supplied)) return false;
  const expected = crypto.createHmac("sha256", PARTIAL_SECRET).update(`${leadId}|${parts[0]}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"));
}

async function resolvePricing(supabase, category, service, requestedIssueCode) {
  if (!category || !service) {
    return { resolved: false, reason: "missing_taxonomy", issue_code: requestedIssueCode || null };
  }

  let query = supabase
    .from("band_map")
    .select("version, category, issue_code, label, band, price_cents, requires_clarification")
    .eq("version", PRICING_VERSION)
    .eq("category", category);

  if (requestedIssueCode) query = query.eq("issue_code", requestedIssueCode);
  else query = query.eq("label", service);

  const { data, error } = await query.limit(2);
  if (error) throw new Error(`pricing_lookup_failed:${error.message}`);
  if (!data || data.length !== 1) {
    return { resolved: false, reason: data && data.length > 1 ? "ambiguous_taxonomy" : "pricing_not_found", issue_code: requestedIssueCode || null };
  }

  const row = data[0];
  const price = Number(row.price_cents);
  if (row.requires_clarification || !row.band || !Number.isInteger(price) || price <= 0) {
    return { resolved: false, reason: "requires_clarification", issue_code: row.issue_code || requestedIssueCode || null };
  }

  return {
    resolved: true,
    issue_code: row.issue_code,
    label: row.label,
    pricing_band: row.band,
    price_cents: price,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(204).end();
  }
  if (req.method === "GET" && req.query?.action === "market_areas") {
    if (!SUPABASE_SERVICE_KEY) return res.status(503).json({ success:false,error:"market_unavailable" });
    const client=createClient(SUPABASE_URL,SUPABASE_SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await client.from("ssp_market_service_areas").select("city,state_code,trade,zip_prefix").eq("enabled",true).limit(100);
    return error?res.status(503).json({success:false,error:"market_unavailable"}):
      res.status(200).json({success:true,market_areas:data||[]});
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ success: false, error: "method_not_allowed" });
  }
  if (!SUPABASE_SERVICE_KEY || !PARTIAL_SECRET || !RATE_LIMIT_SECRET) {
    console.error("create-lead: required server environment missing");
    return res.status(500).json({ success: false, error: "server_misconfigured" });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const body = req.body || {};
  const isPartial = body.partial === true;
  const rateEmail = clean(body.email, 254).toLowerCase();
  const ratePhone = digits(body.phone);
  const contactKey = rateEmail || ratePhone || "no-contact";
  try {
    const [ipAllowed, contactAllowed] = await Promise.all([
      consumeLimit(
        supabase,
        isPartial ? "lead_partial_ip" : "lead_final_ip",
        "ip",
        clientIp(req),
        isPartial ? 20 : 12,
        600
      ),
      consumeLimit(supabase, "lead_contact", rateEmail ? "email" : "phone", contactKey, 12, 3600),
    ]);
    if (!ipAllowed || !contactAllowed) {
      return res.status(429).json({ success: false, error: "too_many_requests" });
    }
  } catch (e) {
    return res.status(503).json({ success: false, error: "rate_limit_unavailable" });
  }

  try {
    const name = clean(body.name, 160);
    const phone = clean(body.phone, 40);
    const phoneDigits = digits(phone);
    const email = clean(body.email, 254).toLowerCase();
    const zip = clean(body.zip, 10);
    const service = clean(body.service, 180);
    const category = clean(body.category, 120);
    const issueCode = clean(body.issue_code, 160) || null;
    const details = clean(body.details, 5000);
    const urgency = mapUrgency(body.urgency);
    const addr = addressFields(body);

    if (!name || name.length < 2 || phoneDigits.length < 10 || !/^\d{5}$/.test(zip) || !validEmail(email)) {
      return res.status(400).json({ success: false, error: "invalid_contact_fields" });
    }
    const {data:marketOpen,error:marketError}=await supabase.rpc("ssp_market_supports_request",{
      p_city:addr.homeowner_city||null,p_state:addr.homeowner_state||null,p_zip:zip,p_trade:category
    });
    if(marketError)return res.status(503).json({success:false,error:"market_check_unavailable"});
    if(marketOpen!==true)return res.status(422).json({success:false,error:"service_area_unavailable",
      message:"SSP is currently serving HVAC requests in Houston-area TX ZIP codes starting 770."});


    // ---------------------------------------------------------------------
    // PARTIAL — capture contact + location only. Never price or match here.
    // ---------------------------------------------------------------------
    if (isPartial) {
      const partialData = Object.assign({
        homeowner_name: name,
        homeowner_phone: phone,
        homeowner_email: email || null,
        homeowner_zip: zip,
        service_category: category || null,
        service_type: service || null,
        urgency: null,
        description: null,
        status: "Partial",
        partial: true,
        source: "website",
        paid: false,
      }, addr);

      const { data, error } = await supabase
        .from("leads")
        .insert([partialData])
        .select("id")
        .single();

      if (error || !data) {
        console.error("create-lead: partial insert failed", error && error.message);
        return res.status(500).json({ success: false, error: "partial_save_failed" });
      }

      return res.status(200).json({
        success: true,
        partial: true,
        leadId: data.id,
        leadToken: partialToken(data.id),
      });
    }

    if (!service) return res.status(400).json({ success: false, error: "service_required" });

    const pricing = await resolvePricing(supabase, category, service, issueCode);
    const now = Date.now();
    const finalFields = Object.assign({
      homeowner_name: name,
      homeowner_phone: phone,
      homeowner_email: email || null,
      homeowner_zip: zip,
      // Once taxonomy resolves, persist the canonical label from band_map rather
      // than trusting a client-supplied display string alongside an issue_code.
      service_type: pricing.resolved ? pricing.label : service,
      service_category: category || null,
      issue_code: pricing.issue_code || issueCode,
      pricing_version: PRICING_VERSION,
      pricing_band: pricing.resolved ? pricing.pricing_band : null,
      price_cents: pricing.resolved ? pricing.price_cents : null,
      matching_expires_at: pricing.resolved ? new Date(now + MATCHING_WINDOW_MS).toISOString() : null,
      description: details || null,
      urgency,
      status: pricing.resolved ? "Priced" : "HeldForReview",
      paid: false,
      source: "website",
      partial: false,
    }, addr);

    const leadIdFromBody = clean(body.leadId, 80);
    const leadToken = clean(body.leadToken, 200);
    let leadId = null;
    let updatedFromPartial = false;

    if (leadIdFromBody) {
      if (!validPartialToken(leadIdFromBody, leadToken)) {
        return res.status(403).json({ success: false, error: "invalid_partial_token" });
      }

      const { data: existing, error: existingError } = await supabase
        .from("leads")
        .select("id, partial, status")
        .eq("id", leadIdFromBody)
        .maybeSingle();

      if (existingError) throw new Error(`partial_lookup_failed:${existingError.message}`);
      if (existing && (existing.partial === true || existing.status === "Partial")) {
        const { data: updated, error: updateError } = await supabase
          .from("leads")
          .update(finalFields)
          .eq("id", leadIdFromBody)
          .eq("partial", true)
          .select("id")
          .maybeSingle();
        if (updateError) throw new Error(`partial_finalize_failed:${updateError.message}`);
        if (updated) {
          leadId = updated.id;
          updatedFromPartial = true;
        }
      }
      // A valid token for a missing/non-partial row is safe to recover by
      // inserting a new final row rather than mutating an unrelated record.
    }

    if (!leadId) {
      const { data: inserted, error: insertError } = await supabase
        .from("leads")
        .insert([finalFields])
        .select("id")
        .single();
      if (insertError || !inserted) throw new Error(`lead_insert_failed:${insertError ? insertError.message : "no row"}`);
      leadId = inserted.id;
    }

    // Pricing may intentionally hold a lead for review. No offer is generated
    // until an issue has a stable code and frozen price.
    if (!pricing.resolved) {
      return res.status(200).json({
        success: true,
        leadId,
        status: "HeldForReview",
        matching_started: false,
        updated_from_partial: updatedFromPartial,
      });
    }

    // Matching is database-owned. Failure here must not cause the browser to
    // retry lead creation and duplicate the homeowner lead. Leave the row
    // Priced so the recovery sweep / future cron can safely retry it.
    const { data: offersMade, error: matchError } = await supabase.rpc("fill_offer_slots", { p_lead_id: leadId });
    if (matchError) {
      console.error("create-lead: fill_offer_slots failed", matchError.message, "lead", leadId);
      return res.status(202).json({
        success: true,
        leadId,
        status: "Priced",
        matching_started: false,
        matching_pending: true,
        updated_from_partial: updatedFromPartial,
      });
    }

    return res.status(200).json({
      success: true,
      leadId,
      status: Number(offersMade || 0) > 0 ? "Offering" : "Priced",
      matching_started: true,
      offers_created: Number(offersMade || 0),
      updated_from_partial: updatedFromPartial,
    });
  } catch (error) {
    if (error && error.message === "invalid_coordinates") {
      return res.status(400).json({ success: false, error: "invalid_coordinates" });
    }
    console.error("create-lead error", error && error.message ? error.message : error);
    return res.status(500).json({ success: false, error: "lead_processing_failed" });
  }
};