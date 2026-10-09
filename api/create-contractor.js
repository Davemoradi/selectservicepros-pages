// api/create-contractor.js
// Free-to-join contractor signup.
//
// SECURITY REWRITE — what was wrong before, and why each one mattered
//
//   1. Math.random() generated the initial password. It is not a CSPRNG and
//      its output is predictable from observed values. Now crypto.randomBytes.
//
//   2. The response returned a one-time Supabase recovery action_link to an
//      UNAUTHENTICATED caller. Anyone who could POST this endpoint with an
//      email address got back a link that sets that account's password —
//      email ownership was never proven. The link is now emailed only.
//
//   3. Identity was matched with .ilike('email', ...). In PostgREST, ilike
//      treats % and _ as wildcards, so a crafted address could match another
//      contractor's row. Now normalized exact equality.
//
//   4. Database failures were logged and the endpoint still returned 200, so
//      the signup page reported success on a failed signup. Real errors now
//      return 5xx.
//
//   5. A failed contractor-row insert left an orphaned auth user, permanently
//      blocking that email from signing up again. Now rolled back.
//
//   6. No durable rate limiting on a public endpoint that creates auth users
//      and sends email. Now enforced through a shared Postgres counter.
//
//   7. licenseNumber / licenseType were written to columns on `contractors`
//      the dashboard no longer reads. Licences belong in contractor_licenses,
//      where the verification trigger applies.
//
//   8. Subscription assumptions — planName, checkout-before-contractor, the
//      Stripe-webhook precreation race — are gone. Signup is free.
//
// NO GHL CALLS. An AFTER INSERT trigger on contractors enqueues
// `contractor_created`, delivered by api/process-notifications.js, keyed on
// contractor id so retries and races cannot produce a second welcome.

const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const SUPABASE_URL = "https://kasqtxwbsmjlisbnebku.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RATE_LIMIT_SECRET = process.env.RATE_LIMIT_SECRET;
const RESET_REDIRECT = "https://www.selectservicepros.com/reset-password.html";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Durable rate limiting is database-backed so every serverless instance shares
// the same counters. Raw IP/email values are HMACed before they reach the DB.
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
    console.error("create-contractor: durable rate limiter failed", error || data);
    throw new Error("rate_limit_unavailable");
  }
  return data[0].allowed === true;
}

function normalizeEmail(raw) {
  return String(raw || "").trim().toLowerCase();
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "method_not_allowed" });
  }
  if (!SUPABASE_SERVICE_KEY || !RATE_LIMIT_SECRET) {
    console.error("create-contractor: SUPABASE_SERVICE_ROLE_KEY or RATE_LIMIT_SECRET missing");
    return res.status(500).json({ success: false, error: "server_misconfigured" });
  }

  const b = req.body || {};
  const email = normalizeEmail(b.email);
  const firstName = String(b.firstName || "").trim().slice(0, 100);
  const lastName = String(b.lastName || "").trim().slice(0, 100);
  const phone = String(b.phone || "").trim().slice(0, 40);
  const companyName = String(b.companyName || "").trim().slice(0, 200);
  const serviceCategories = String(b.serviceCategories || "").trim().slice(0, 500);
  const serviceZips = String(b.serviceZips || "").trim().slice(0, 2000);

  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ success: false, error: "invalid_email" });
  }
  if (!firstName || !lastName) {
    return res.status(400).json({ success: false, error: "missing_name" });
  }

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const [ipAllowed, emailAllowed] = await Promise.all([
      consumeLimit(supabase, "contractor_signup_ip", "ip", ip, 5, 600),
      consumeLimit(supabase, "contractor_signup_email", "email", email, 4, 3600),
    ]);
    if (!ipAllowed || !emailAllowed) {
      return res.status(429).json({
        success: false,
        error: "rate_limited",
        message: "Too many signup attempts. Please wait and try again.",
      });
    }
  } catch (e) {
    return res.status(503).json({ success: false, error: "rate_limit_unavailable" });
  }

  let createdAuthId = null;
  let createdContractorId = null;

  try {
    // ---- 1. Idempotency: exact, normalized match --------------------------
    const { data: existing, error: lookupErr } = await supabase
      .from("contractors")
      .select("id, auth_id, email, status")
      .eq("email", email)          // exact. never ilike — % and _ are wildcards
      .maybeSingle();

    if (lookupErr) {
      console.error("create-contractor: lookup failed", lookupErr);
      return res.status(500).json({ success: false, error: "lookup_failed" });
    }

    if (existing) {
      // Already registered. Do not disclose account state, and do not mint a
      // recovery link for an unverified caller — that is an account-takeover
      // path. Send them through the ordinary reset flow instead.
      await supabase.auth
        .resetPasswordForEmail(email, { redirectTo: RESET_REDIRECT })
        .catch((e) => console.error("create-contractor: reset email failed", e && e.message));

      return res.status(200).json({
        success: true,
        already_registered: true,
        message: "That email is already registered. Check your inbox to set or reset your password.",
      });
    }

    const {data:activeMarkets,error:areaError}=await supabase.from("ssp_market_service_areas")
      .select("trade,zip_prefix").eq("enabled",true).limit(100);
    if(areaError)return res.status(503).json({success:false,error:"service_area_check_unavailable",
      message:"We could not verify contractor coverage right now. Please try again."});
    const trades=new Set(serviceCategories.split(",").map(x=>x.trim().toLowerCase()).filter(Boolean));
    const zips=serviceZips.split(",").map(x=>x.trim()).filter(x=>/^\d{5}$/.test(x)).slice(0,250);
    const accepts=(activeMarkets||[]).some(m=>trades.has(String(m.trade||"").toLowerCase())
      &&zips.some(z=>z.startsWith(m.zip_prefix)));
    if(!accepts)return res.status(422).json({success:false,error:"service_area_unavailable",
      message:"SSP is currently onboarding HVAC contractors serving Houston-area ZIP codes starting 770. Other locations and trades are coming later."});

    // ---- 2. Auth user with a CSPRNG placeholder password -------------------
    // The contractor never learns this value; they set a real one through the
    // emailed link.
    const placeholder = crypto.randomBytes(32).toString("base64url");

    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email,
      password: placeholder,
      email_confirm: false,        // ownership is proven by the emailed link
      user_metadata: { first_name: firstName, last_name: lastName, role: "contractor" },
    });

    if (authErr) {
      // Auth user exists but no contractor row: an earlier partial signup.
      if (/already|exists|registered/i.test(authErr.message || "")) {
        await supabase.auth
          .resetPasswordForEmail(email, { redirectTo: RESET_REDIRECT })
          .catch(() => {});
        return res.status(200).json({
          success: true,
          already_registered: true,
          message: "That email is already registered. Check your inbox to set or reset your password.",
        });
      }
      console.error("create-contractor: auth create failed", authErr);
      return res.status(500).json({ success: false, error: "auth_create_failed" });
    }

    createdAuthId = authData && authData.user && authData.user.id;
    if (!createdAuthId) {
      console.error("create-contractor: auth user created without an id");
      return res.status(500).json({ success: false, error: "auth_create_failed" });
    }

    // ---- 3. Contractor row -------------------------------------------------
    // The AFTER INSERT trigger enqueues contractor_created here — only once the
    // auth relationship is real. No tier, no plan, no Stripe.
    const { data: contractor, error: insErr } = await supabase
      .from("contractors")
      .insert({
        auth_id: createdAuthId,
        email,
        first_name: firstName,
        last_name: lastName,
        phone: phone || null,
        company_name: companyName || null,
        service_categories: serviceCategories || null,
        service_zips: serviceZips || null,
        status: "Pending Profile",
      })
      .select("id")
      .single();

    if (insErr || !contractor) {
      // Do not strand the auth user — it would block this email forever.
      console.error("create-contractor: contractor insert failed", insErr);
      try {
        await supabase.auth.admin.deleteUser(createdAuthId);
        createdAuthId = null;
        console.warn("create-contractor: rolled back orphan auth user");
      } catch (delErr) {
        console.error("create-contractor: ORPHAN AUTH USER", createdAuthId,
                      "- manual cleanup required:", delErr && delErr.message);
      }
      return res.status(500).json({ success: false, error: "contractor_create_failed" });
    }
    createdContractorId = contractor.id;

    // ---- 4. Licences go in contractor_licenses ----------------------------
    // Not onto columns of `contractors` the dashboard no longer reads. The
    // insert trigger forces verified=false regardless of what is sent.
    const licenses = Array.isArray(b.licenses) ? b.licenses.slice(0, 10) : [];
    if (licenses.length) {
      const rows = licenses
        .filter((l) => l && (l.number || l.licenseNumber))
        .map((l) => ({
          contractor_id: contractor.id,
          trade_category: String(l.trade || l.tradeCategory || "").slice(0, 100) || null,
          license_type: String(l.type || l.licenseType || "").slice(0, 100) || null,
          license_state: String(l.state || l.licenseState || "").slice(0, 10) || null,
          license_number: String(l.number || l.licenseNumber || "").slice(0, 100),
          expiration_date: l.expiration || l.expirationDate || null,
        }));
      if (rows.length) {
        const { error: licErr } = await supabase.from("contractor_licenses").insert(rows);
        // Non-fatal: the account exists and licences can be added in the
        // dashboard. Failing the whole signup here would be worse.
        if (licErr) console.error("create-contractor: licence insert failed", licErr);
      }
    }

    // ---- 5. Email the set-password link. Never return it. ------------------
    const { error: mailErr } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: RESET_REDIRECT,
    });
    if (mailErr) {
      // The account is real; only delivery failed. Report partial success so
      // the UI can direct them to "Forgot password" rather than implying
      // nothing happened.
      console.error("create-contractor: set-password email failed", mailErr);
      return res.status(200).json({
        success: true,
        contractor_id: contractor.id,
        email_sent: false,
        message: 'Account created, but we could not send the setup email. Use "Forgot password" on the sign-in page.',
      });
    }

    return res.status(201).json({
      success: true,
      contractor_id: contractor.id,
      email_sent: true,
      message: "Account created. Check your email to set your password.",
    });
  } catch (e) {
    console.error("create-contractor: unhandled", e && e.message);
    // Roll back the auth user only if the contractor row never committed.
    // Once the contractor row exists, deleting auth here would create the
    // opposite orphan: a contractor row whose auth_id points to no user.
    if (createdAuthId && !createdContractorId) {
      try { await supabase.auth.admin.deleteUser(createdAuthId); }
      catch (_) { console.error("create-contractor: ORPHAN AUTH USER", createdAuthId); }
    }
    return res.status(500).json({
      success: false,
      error: createdContractorId ? "post_create_failed" : "unexpected_error",
    });
  }
};