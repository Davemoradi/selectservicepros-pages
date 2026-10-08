#!/usr/bin/env node
/**
 * scripts/verify-ssp-hardening.js
 *
 * Static verification of the SSP hardening pass.
 *
 * DESIGN NOTE — why this exists
 *   The repeated failure in this work was: fix one literal string, grep for
 *   that same literal, declare clean, then discover the equivalent bug three
 *   lines away under a different spelling. `insurance_verified: false` was
 *   removed and verified as zero while `insurance_verified: !!i.verified` sat
 *   in persistProfile() untouched.
 *
 *   So this script does not trust literals. Where it matters it PARSES: it
 *   extracts the actual column names the dashboard writes out of the real
 *   update payloads, extracts the actual grant allowlist out of the migration,
 *   and diffs the two sets. Drift in either direction fails the run.
 *
 * Usage:  node scripts/verify-ssp-hardening.js [--dir <path>]
 * Exit:   0 all checks pass, 1 any failure.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const argDir = process.argv.indexOf("--dir");
const ROOT = argDir > -1 ? process.argv[argDir + 1] : process.cwd();

const FILES = {
  dashboard: "contractor-dashboard.html",
  home: "index.html",
  signup: "contractor-signup.html",
  adminDashboard: "admin-dashboard.html",
  legacyAdmin: "admin.html",
  legacyLeadPage: "lead-response.html",
  publicConfig: "ssp-config.js",
  intake: "intake-v2.html",
  taxonomy: "ssp-taxonomy-v1.js",
  pricingDoc: "SSP-PRICING-TAXONOMY-v1.md",
  privacy: "privacy-policy.html",
  createLead: "api/create-lead.js",
  accept: "api/lead-accept.js",
  decline: "api/lead-decline.js",
  workflow: "api/contractor-workflow.js",
  worker: "api/process-notifications.js",
  createContractor: "api/create-contractor.js",
  adminAuth: "api/_admin-auth.js",
  adminData: "api/admin-data.js",
  adminUpdate: "api/admin-update-contractor.js",
  adminDocument: "api/admin-document-url.js",
  leadDispute: "api/lead-dispute.js",
  adminDisputeDecision: "api/admin-dispute-decision.js",
  legacyLeadApi: "api/lead-response.js",
  legacyPricingApi: "api/save-pricing.js",
  legacyAdminConfigApi: "api/admin-config.js",
  checkout: "api/create-checkout-session.js",
  stripeWebhook: "api/stripe-webhook.js",
  sqlSecurity: "supabase/migrations/20260916_01_contractor_schema_security.sql",
  sqlOutbox: "supabase/migrations/20260916_02_notification_outbox.sql",
  sqlPricing: "supabase/migrations/20260917_03_pricing_taxonomy_v1.sql",
  sqlWalletTopup: "supabase/migrations/20260923_04_wallet_topup_guardrails.sql",
  sqlRateLimits: "supabase/migrations/20260923_05_api_rate_limits.sql",
  sqlFoundingPromo: "supabase/migrations/20260923_06_founding25_promo.sql",
  sqlDisputes: "supabase/migrations/20260923_07_dispute_decisions.sql",
  eventContract: "SSP-GHL-EVENT-CONTRACT.md",
  runbook: "SSP-PREDEPLOY-RUNBOOK.md",
};

let PASS = 0, FAIL = 0, SKIP = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) { PASS++; console.log(`  PASS  ${name}`); }
  else    { FAIL++; failures.push(name); console.log(`  FAIL  ${name}${detail ? "  -> " + detail : ""}`); }
}
function skip(name, why) { SKIP++; console.log(`  SKIP  ${name}  (${why})`); }
// A release run must not be green with a required artifact missing.
const MANDATORY = Object.keys(FILES);
function requireFile(key) {
  const p = path.join(ROOT, FILES[key]);
  const ok = fs.existsSync(p);
  check(`REQUIRED FILE PRESENT: ${FILES[key]}`, ok, ok ? "" : "missing at expected path");
  return ok;
}
function read(key) {
  const p = path.join(ROOT, FILES[key]);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
}
function section(t) { console.log(`\n=== ${t} ===`); }

section("REQUIRED FILES");
MANDATORY.forEach(requireFile);

// ---------------------------------------------------------------- DASHBOARD
section("DASHBOARD — no privileged client writes");
const D = read("dashboard");
if (!D) {
  skip("dashboard checks", "file missing");
} else {
  // ---- EXTRACTION -------------------------------------------------------
  // The previous version only matched literal `.update({...})`. persistProfile()
  // builds `const payload = {...}` and calls `.update(payload)`, so the real
  // 25-column write was invisible and the reconciliation passed vacuously.
  // This resolves named payload variables as well as inline objects.
  function braceBlockAt(src, openIdx) {
    let depth = 0;
    for (let j = openIdx; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") { depth--; if (depth === 0) return src.slice(openIdx + 1, j); }
    }
    return "";
  }
  // TOP-LEVEL keys only. A nested object (business_hours: Object.assign({},
  // o.hours, { _confirmed: ... })) contributes one column, not two.
  function keysOf(body) {
    const keys = [];
    let depth = 0, atKeyPos = true, buf = "";
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === "{" || ch === "[" || ch === "(") { depth++; buf = ""; continue; }
      if (ch === "}" || ch === "]" || ch === ")") { depth--; buf = ""; continue; }
      if (depth !== 0) continue;
      if (ch === ",") { atKeyPos = true; buf = ""; continue; }
      if (ch === ":") {
        if (atKeyPos && /^[a-z_][a-z0-9_]*$/i.test(buf.trim())) keys.push(buf.trim());
        atKeyPos = false; buf = ""; continue;
      }
      buf += ch;
    }
    return keys;
  }
  // `const NAME = { ... }` anywhere in the file
  function namedObject(src, name) {
    const m = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\{`).exec(src);
    return m ? braceBlockAt(src, src.indexOf("{", m.index)) : null;
  }

  function writesTo(src, table) {
    const found = new Set();
    const sources = [];
    const re = new RegExp(`from\\(['"]${table}['"]\\)\\s*(?:\\r?\\n\\s*)?\\.(?:update|insert)\\(`, "g");
    let m;
    while ((m = re.exec(src))) {
      const argStart = m.index + m[0].length;
      const rest = src.slice(argStart, argStart + 200);
      if (/^\s*\{/.test(rest)) {
        const body = braceBlockAt(src, src.indexOf("{", argStart));
        keysOf(body).forEach(k => found.add(k));
        sources.push("inline-object");
      } else {
        const v = /^\s*([A-Za-z_$][\w$]*)/.exec(rest);
        if (v) {
          const body = namedObject(src, v[1]);
          if (body) { keysOf(body).forEach(k => found.add(k)); sources.push(`var:${v[1]}`); }
          else sources.push(`var:${v[1]}(UNRESOLVED)`);
        }
      }
    }
    return { cols: found, sources };
  }

  const cw = writesTo(D, "contractors");
  const lw = writesTo(D, "contractor_licenses");
  const contractorWrites = cw.cols;
  const licenseWrites = lw.cols;

  // LICENSE_FIELD_MAP values are written as columns by the debounce queue.
  const licMap = D.match(/const LICENSE_FIELD_MAP = \{([\s\S]*?)\};/);
  if (licMap) for (const m of licMap[1].matchAll(/:\s*'([a-z_]+)'/g)) licenseWrites.add(m[1]);

  console.log(`        contractor write sources: ${cw.sources.join(", ") || "none"}`);
  console.log(`        contractor columns written (${contractorWrites.size}): ${[...contractorWrites].sort().join(", ")}`);
  console.log(`        license columns written (${licenseWrites.size}): ${[...licenseWrites].sort().join(", ")}`);
  check("no UNRESOLVED payload variables",
    !cw.sources.concat(lw.sources).some(x => x.includes("UNRESOLVED")),
    cw.sources.concat(lw.sources).filter(x => x.includes("UNRESOLVED")).join(", "));
  check("persistProfile payload resolved (>=20 cols)", contractorWrites.size >= 20,
    `only ${contractorWrites.size} found`);

  const FORBIDDEN_CONTRACTOR = [
    "status", "lead_balance_cents", "promo_credits_cents", "membership_tier",
    "stripe_customer_id", "auth_id", "insurance_verified", "insurance_verified_at",
    "agreement_accepted_at", "agreement_accepted_ip", "agreement_accepted_user_agent",
    "agreement_version", "agreement_signed_name", "deletion_requested_at",
  ];
  for (const col of FORBIDDEN_CONTRACTOR) {
    check(`browser does not write contractors.${col}`, !contractorWrites.has(col),
      contractorWrites.has(col) ? "found in an .update() payload" : "");
  }
  for (const col of ["verified", "verified_at", "verified_by"]) {
    check(`browser does not write contractor_licenses.${col}`, !licenseWrites.has(col));
  }

  check("no direct .from('leads') read", !/from\(['"]leads['"]\)/.test(D));
  check("no assigned_contractor_id usage", !/assigned_contractor_id/.test(D));
  check("no getPublicUrl", !/getPublicUrl/.test(D));
  check("uses createSignedUrl", /createSignedUrl/.test(D));
  check("no browser GHL URLs", !/leadconnectorhq/.test(D));
  check("no fireHomeownerMatched", !/fireHomeownerMatched/.test(D));
  check("no ipify call", !/ipify/.test(D));
  check("no deleteAccount()", !/function deleteAccount/.test(D));
  check("no membership tier UI", !/tierBadge|navTier|billingPreviewHTML/.test(D));
  check("no legacy $99/$29 pricing", !/\$99|\$29\b/.test(D));
  check("no Manage Subscription", !/Manage subscription/i.test(D));
  check("no executable SQL embedded", !/CREATE POLICY|ADD COLUMN|storage\.buckets/.test(D));
  check("migrations referenced by path", /supabase\/migrations\/20260916_01/.test(D));
  check("escapeHTML helper present", /function escapeHTML/.test(D));
  check("deletion copy is a REQUEST", /Request account deletion/.test(D));
  check("no false 'permanent deletion' claim",
    !/All your leads, credentials, and billing history go away/.test(D));
  check("notification toggles disabled", /Coming soon/.test(D) && /aria-disabled="true"/.test(D));
  check("SMS defaults OFF", /sms:false/.test(D));
  check("wallet top-up wired to authenticated endpoint",
    /fetch\('\/api\/create-checkout-session'/.test(D) && /Authorization':'Bearer '/.test(D));
  check("wallet top-up presets present",
    /topUpCard\(10000\)/.test(D) && /topUpCard\(25000\)/.test(D) && /topUpCard\(50000\)/.test(D));
  check("wallet top-up browser never credits balance",
    !/credit_wallet|wallet_transactions['"]\)\.insert/.test(D));
  check("wallet top-up return refreshes only", /topupResult/.test(D) && /loadWallet\(\)/.test(D));
  check("no 'licensed contractors' blanket claim",
    !/with licensed contractors\./.test(D));
  check("agreement v2 in dashboard", /AGREEMENT_VERSION = 'v2'/.test(D));
  // Inspect the HYDRATION expression specifically: `?? true` would enable SMS
  // whenever the column is null, regardless of any `sms:false` default elsewhere.
  check("SMS hydration cannot default true",
    !/notif_sms\s*\?\?\s*true/.test(D) && /notif_sms === true/.test(D));
  check("status map is exact, not substring",
    /DB_TO_UI_STATUS/.test(D) && !/s\.includes\('active'\)/.test(D));
  check("Inactive maps to blocked", /'inactive':\s*'blocked'/.test(D));
  check("agreement uses server-returned status", /state\.dbStatus = body\.status/.test(D));
  check("insurance Remove persists", /function removeDoc/.test(D) && /insurance_doc_url: null/.test(D));
  check("no stale contractor-document endpoint comment", !/api\/contractor-document/.test(D));
  check("decline refill retried when pending", /refill_pending/.test(D) && /refill_only/.test(D));
  check("accepted lead exposes dispute action", /openLeadDispute/.test(D) && /Dispute lead charge/.test(D));
  check("dispute submits through authenticated API", /fetch\('\/api\/lead-dispute'/.test(D) && /lead_id:leadId/.test(D));
  check("dispute UI states seven-day window", /within 7 calendar days/.test(D));
  check("agreement contains no lawyer drafting note", !/Lawyer note:|preference TBD/i.test(D));
  check("licensing terminology neutral",
    !/UNLICENSED_TRADES|UNSSP_LICENSE_COLLECTION_TRADES/.test(D) && !/no trade license is required/.test(D));
  check("no unsupported review SLA copy",
    !/within one business day|within 24 hours|usually within|typically within/i.test(D));
  check("no stale production wiring block",
    !/GHL_REVIEW_WEBHOOK|TODO \/ MANUAL WIRING NEEDED BEFORE PRODUCTION/.test(D));

  // structure
  check("exactly one </body>", (D.match(/<\/body>/g) || []).length === 1);
  check("exactly one </html>", (D.match(/<\/html>/g) || []).length === 1);
  check("<!--email_off--> present", /<!--email_off-->/.test(D));

  // ---------------------------------------------- GRANT / WRITE RECONCILIATION
  section("RECONCILIATION — dashboard writes vs SQL grants");
  const SEC = read("sqlSecurity");
  if (!SEC) {
    skip("grant reconciliation", "migration missing");
  } else {
    const block = SEC.slice(SEC.indexOf("allow_contractors text[]"), SEC.indexOf("lic_insert text[]"));
    const granted = new Set([...block.matchAll(/'([a-z_]+)'/g)].map(m => m[1]));

    const notGranted = [...contractorWrites].filter(c => !granted.has(c));
    check("every dashboard-written contractor column is granted",
      notGranted.length === 0, notGranted.join(", "));

    const leaked = FORBIDDEN_CONTRACTOR.filter(c => granted.has(c));
    check("no sensitive contractor column is granted", leaked.length === 0, leaked.join(", "));

    const licBlock = SEC.slice(SEC.indexOf("lic_insert text[]"), SEC.indexOf("c text; n int"));
    const licGranted = new Set([...licBlock.matchAll(/'([a-z_]+)'/g)].map(m => m[1]));
    for (const c of ["verified", "verified_at", "verified_by"]) {
      check(`license ${c} not granted`, !licGranted.has(c));
    }
    console.log(`        (dashboard writes ${contractorWrites.size} contractor columns; ` +
                `${granted.size} granted)`);
  }
}


// ---------------------------------------------------------------- HOMEPAGE
section("HOMEPAGE");
const H = read("home");
if (!H) skip("homepage checks", "file missing");
else {
  check("homepage has no direct GHL webhook", !/leadconnectorhq|var GHL=/.test(H));
  check("homepage posts homeowner requests to create-lead", /fetch\("\/api\/create-lead"/.test(H));
  check("homepage has no TDLR/background-check promise", !/TDLR|background checks?/i.test(H));
  check("homepage has no response-time promise", !/within minutes|within an hour|average first response/i.test(H));
  check("homepage has no retired membership-tier pitch", !/membership tiers?|\bBasic\b|\bElite\b|Pro (?:tier|plan|membership)/i.test(H));
  check("homepage avoids blanket licensed-provider claim", !/licensed contractors|licensed professionals|licensed service professionals/i.test(H));
  check("homepage no fake confirmation-sent claim", !/confirmation has been sent/i.test(H));
  check("homepage success uses textContent for user fields", /lead-success-title/.test(H) && /\.textContent="You are all set/.test(H));
  check("homepage loads canonical taxonomy", /<script src="\/ssp-taxonomy-v1\.js"><\/script>/.test(H));
  check("homepage sends stable issue_code", /issue_code:issueCode/.test(H));
  check("homepage no longer embeds duplicate CO taxonomy", !/var CO=\{\"HVAC\"/.test(H));
}

// ---------------------------------------------------------------- SIGNUP
section("CONTRACTOR SIGNUP");
const S = read("signup");
if (!S) {
  skip("contractor-signup checks", "file missing");
} else {
  check("signup is free-to-join", /Create free account/.test(S) && /no monthly subscription/i.test(S));
  check("signup posts to create-contractor", /fetch\('\/api\/create-contractor'/.test(S));
  check("signup has no plan picker", !/PLAN_FEATURES|Choose your plan|Pick a plan|choosePlan\(/.test(S));
  check("signup has no Stripe checkout", !/create-checkout-session|Stripe\(|js\.stripe\.com|Payment Successful/i.test(S));
  check("signup has no direct GHL", !/leadconnectorhq|GHL[_=]/.test(S));
  check("signup has no retired tiers", !/\b(?:Basic|Pro|Elite)\b/.test(S));
  check("signup has no priority/exclusive routing claims", !/priority access|first access|exclusive window|tiered lead routing/i.test(S));
  check("signup has no passwordResetUrl dependency", !/passwordResetUrl|action_link/.test(S));
  check("signup does not promise TDLR verification", !/TDLR|Texas Department of Licensing and Regulation/i.test(S));
  check("signup does not promise instant lead timing", !/within minutes|first lead in minutes|60 minutes|45 minutes|30 minutes/i.test(S));
  check("signup SMS is not auto-opt-in", /SMS lead alerts are optional/.test(S));
}

// ---------------------------------------------------------------- LEGACY RETIREMENT
section("LEGACY SURFACES RETIRED");
const LRH = read("legacyLeadPage");
const LRA = read("legacyLeadApi");
const LPA = read("legacyPricingApi");
const LAC = read("legacyAdminConfigApi");
const LAH = read("legacyAdmin");
const PC = read("publicConfig");
if (LRH) {
  check("legacy lead-response page cannot accept/charge", /older response link has been retired/i.test(LRH) && !/lead_fee|contractorId|no-cors|leadconnectorhq/i.test(LRH));
}
if (LRA) check("legacy lead-response API returns 410", /status\(410\)/.test(LRA) && /retired_endpoint/.test(LRA));
if (LPA) check("legacy save-pricing API returns 410", /status\(410\)/.test(LPA) && /retired_endpoint/.test(LPA));
if (LAC) check("legacy admin-config API returns 410", /status\(410\)/.test(LAC) && /retired_endpoint/.test(LAC) && !/ssp2025/.test(LAC));
if (LAH) check("legacy admin page redirects to operations dashboard", /admin-dashboard\.html/.test(LAH) && !/ssp2025/.test(LAH));
if (PC) {
  check("public config has no legacy tiers", !/monthlyPrice|leadPrice|leadWindowMinutes|\bBasic\b|\bPro\b|\bElite\b/.test(PC));
  check("public config has no GHL secret/webhook", !/leadconnectorhq|webhook-trigger|subAccountId/.test(PC));
  check("public config reflects 15m/60m/3-cap model", /offerWindowMinutes: 15/.test(PC) && /matchingWindowMinutes: 60/.test(PC) && /maxAcceptedContractors: 3/.test(PC));
}

// ---------------------------------------------------------------- PRIVACY
section("PRIVACY POLICY");
const PP = read("privacy");
if (!PP) skip("privacy policy checks", "file missing");
else {
  check("privacy says pre-accept limited info", /limited, structured summary of the request/i.test(PP) && /do not disclose your name, phone number, email address, street address, or free-text job description/i.test(PP));
  check("privacy releases PII after acceptance", /affirmatively accepts the lead/i.test(PP) && /up to three \(3\) providers may accept/i.test(PP));
  check("privacy avoids blanket licensed-contractor sharing claim", !/up to three.*licensed contractors/i.test(PP));
}

// ---------------------------------------------------------------- ADMIN
section("ADMIN OPERATIONS");
const AD = read("adminDashboard");
if (!AD) skip("admin dashboard checks", "file missing");
else {
  check("admin dashboard uses Supabase login", /signInWithPassword/.test(AD));
  check("admin dashboard uses bearer API auth", /Authorization':'Bearer '/.test(AD));
  check("admin dashboard has no shared password", !/ssp2025|ADMIN_PASSWORD/.test(AD));
  check("admin dashboard has no retired tier model", !/membership_tier|totalMRR|\bBasic\b|\bElite\b/.test(AD));
  check("admin dashboard escapes rendered values", /function esc\(/.test(AD));
  check("admin dashboard uses new lead offers", /accepted_offers|lead_offers|offers/.test(AD));
  check("admin dashboard exposes atomic Founding 25 approval", /approve_founding25/.test(AD));
  check("admin dashboard retains grant-only recovery action", /grant_founding25/.test(AD));
  check("admin dashboard pricing is read-only", /Read-only view of the database price map/.test(AD));
  check("admin dashboard can decide disputes", /decideDispute/.test(AD) && /\/api\/admin-dispute-decision/.test(AD));
  check("admin dashboard can securely view private evidence", /viewDocument/.test(AD) && /\/api\/admin-document-url/.test(AD));
  check("admin dashboard exposes activate-only path", /activateOnly/.test(AD) && /action:'activate'/.test(AD));
  check("admin dashboard shows Founding 25 capacity", /founding25_grants/.test(AD) && /\/25/.test(AD));
  check("admin dashboard escapes dispute evidence", /esc\(x\.evidence/.test(AD));
}
const AA = read("adminAuth");
if (!AA) skip("admin auth checks", "file missing");
else {
  check("admin auth verifies bearer token", /auth\.getUser\(token\)/.test(AA));
  check("admin auth requires role or allowlist", /app_metadata/.test(AA) && /SSP_ADMIN_EMAILS/.test(AA));
  check("admin auth has no fallback password", !/password|ssp2025/i.test(AA));
}
const ADA = read("adminData");
if (!ADA) skip("admin data checks", "file missing");
else {
  check("admin data requires admin auth", /requireAdmin/.test(ADA));
  check("admin data has no MRR/tier stats", !/totalMRR|membership_tier|Basic|Elite/.test(ADA));
  check("admin data reads offers and wallet", /lead_offers/.test(ADA) && /wallet_transactions/.test(ADA));
  check("admin data does not use assigned_contractor_id", !/assigned_contractor_id/.test(ADA));
  check("admin data exposes dispute evidence and restoration", /evidence/.test(ADA) && /restored_promo_cents/.test(ADA) && /restored_paid_cents/.test(ADA));
  check("admin data includes private document paths for admin review", /insurance_doc_url/.test(ADA) && /document_url/.test(ADA));
  check("admin data counts Founding 25 grants by idempotency key", /founding25_grants/.test(ADA) && /idempotency_key/.test(ADA));
}
const AU = read("adminUpdate");
if (!AU) skip("admin update checks", "file missing");
else {
  check("admin update requires admin auth", /requireAdmin/.test(AU));
  check("admin update has explicit status allowlist", /ALLOWED_STATUSES/.test(AU));
  check("admin update can verify insurance/license", /set_insurance_verified/.test(AU) && /set_license_verified/.test(AU));
  check("admin update grants promo only via RPC", /grant_founding25_promo/.test(AU));
  check("admin update supports atomic approve + promo", /approve_founding25_contractor/.test(AU));
  check("admin update activates only through readiness RPC", /action === "activate"/.test(AU) && /rpc\("activate_contractor"/.test(AU));
  check("admin update cannot set Active directly", !/ALLOWED_STATUSES[^\n]*Active/.test(AU));
  check("admin update has no shared password", !/ADMIN_PASSWORD|ssp2025/.test(AU));
}

// ------------------------------------------------------------ HOMEOWNER INTAKE
section("HOMEOWNER INTAKE + CREATE LEAD");
const I = read("intake");
if (!I) skip("intake checks", "file missing");
else {
  check("intake stores signed partial token", /leadToken:\s*null/.test(I) && /state\.leadToken = data\.leadToken/.test(I));
  check("intake sends signed partial token on final", /leadToken:\s*state\.leadToken/.test(I));
  check("intake still captures partial first", /partial:\s*true/.test(I) && /sendPartialLead/.test(I));
  check("intake loads canonical taxonomy", /<script src="\/ssp-taxonomy-v1\.js"><\/script>/.test(I));
  check("intake sends stable issue_code", /issue_code:\s*state\.issueCode/.test(I));
  check("intake requires issue code before final submit", /!state\.issueCode/.test(I));
  check("intake no longer embeds old string taxonomy", !/const ISSUES = \{/.test(I));
}

section("PRICING TAXONOMY V1");
const TAX = read("taxonomy");
const PRSQL = read("sqlPricing");
if (!TAX || !PRSQL) {
  skip("pricing taxonomy checks", "taxonomy or pricing migration missing");
} else {
  let tax = null;
  try {
    const taxPath = path.resolve(ROOT, FILES.taxonomy);
    delete require.cache[require.resolve(taxPath)];
    tax = require(taxPath);
  } catch (e) {
    check("taxonomy module loads in Node", false, String(e.message || e));
  }
  if (tax) {
    check("taxonomy module loads in Node", true);
    check("taxonomy version is v1", tax.version === "v1");
    check("taxonomy band prices fixed", tax.prices_cents && tax.prices_cents.A === 7500 && tax.prices_cents.B === 3500 && tax.prices_cents.C === 1800);
    const rows = Object.entries(tax.issues || {}).flatMap(([category, arr]) => (arr || []).map(r => ({...r, category})));
    const codes = rows.map(r => r.code);
    const labels = rows.map(r => `${r.category}\u0000${r.label}`);
    const held = rows.filter(r => r.requires_clarification);
    console.log(`        taxonomy rows=${rows.length} priced=${rows.length-held.length} held=${held.length}`);
    console.log(`        taxonomy categories: ${Object.entries(tax.issues || {}).map(([k,v]) => `${k}=${v.length}`).join(", ")}`);
    check("taxonomy has 106 canonical rows", rows.length === 106, `found ${rows.length}`);
    check("taxonomy has unique issue codes", new Set(codes).size === codes.length);
    check("taxonomy has unique category/label pairs", new Set(labels).size === labels.length);
    check("taxonomy holds exactly 7 ambiguous rows", held.length === 7, `found ${held.length}`);
    check("held rows have no band/price", held.every(r => r.band == null && r.price_cents == null));
    check("priced rows have exact band price", rows.filter(r => !r.requires_clarification).every(r => ({A:7500,B:3500,C:1800}[r.band] === r.price_cents)));
    const legacyCompounds = ["Duct cleaning or repair","Pipe repair / repiping","Wiring repair or upgrade","Shingle repair / replacement","Gutter install or repair","Door installation"];
    check("six legacy compound labels removed", legacyCompounds.every(x => !rows.some(r => r.label === x)));
    const splitLabels = ["Duct cleaning","Duct repair","Pipe repair","Whole-home repiping","Wiring repair","Wiring upgrade / rewiring","Shingle repair","Shingle replacement","Gutter repair","Gutter installation","Interior door installation","Exterior / entry door installation"];
    check("twelve split labels present", splitLabels.every(x => rows.some(r => r.label === x)));
    check("pricing SQL asserts exact row count", /v_count <> 106/.test(PRSQL));
    check("pricing SQL asserts exact held count", /v_held <> 7/.test(PRSQL));
    check("pricing SQL clears only v1 before seed", /delete from public\.band_map where version = 'v1'/.test(PRSQL));
    const missingCodes = codes.filter(c => !PRSQL.includes(`'${c}'`));
    check("pricing SQL contains every taxonomy issue_code", missingCodes.length === 0, missingCodes.join(", "));
    const sqlRowCount = (PRSQL.match(/\('v1',/g) || []).length;
    check("pricing SQL contains exactly 106 seed rows", sqlRowCount === 106, `found ${sqlRowCount}`);
  }
}

const CL = read("createLead");
if (!CL) skip("create-lead checks", "file missing");
else {
  const CLcode = CL.replace(/^\s*\/\/.*$/gm, "");
  check("create-lead requires service role", /SUPABASE_SERVICE_ROLE_KEY/.test(CLcode) && !/SUPABASE_SERVICE_KEY \|\| SUPABASE_ANON_KEY/.test(CLcode));
  check("create-lead has no hardcoded anon JWT", !/eyJhbGciOiJIUzI1Ni/.test(CLcode));
  check("create-lead has no direct GHL", !/leadconnectorhq|GHL_WEBHOOK|CONTRACTOR_NOTIFY_WEBHOOK|HOMEOWNER_NOTIFY_WEBHOOK/.test(CLcode));
  check("create-lead has no tier routing", !/TIER_PRIORITY|TIER_RESPONSE_WINDOW|membership_tier|Basic|Elite/.test(CLcode));
  check("create-lead never writes assigned_contractor_id", !/assigned_contractor_id/.test(CLcode));
  check("create-lead never writes legacy lead_fee", !/lead_fee/.test(CLcode));
  check("create-lead snapshots pricing v1", /PRICING_VERSION = "v1"/.test(CL) && /pricing_version: PRICING_VERSION/.test(CL));
  check("create-lead resolves stable issue code", /band_map/.test(CL) && /issue_code/.test(CL));
  check("create-lead freezes price_cents", /price_cents: pricing\.resolved \? pricing\.price_cents/.test(CL));
  check("create-lead stores canonical band-map label", /service_type: pricing\.resolved \? pricing\.label : service/.test(CL));
  check("create-lead sets 60m matching window", /MATCHING_WINDOW_MS = 60 \* 60 \* 1000/.test(CL));
  check("create-lead delegates matching to RPC", /rpc\("fill_offer_slots"/.test(CL));
  check("create-lead partials never match", /status: "Partial"/.test(CL));
  check("create-lead holds unresolved pricing", /"HeldForReview"/.test(CL));
  check("create-lead uses signed partial authorization", /LEAD_PARTIAL_SECRET/.test(CL) && /timingSafeEqual/.test(CL));
  check("create-lead does not silently overwrite arbitrary leadId", /invalid_partial_token/.test(CL) && /\.eq\("partial", true\)/.test(CL));
  check("create-lead matching failure avoids duplicate browser retry", /status\(202\)/.test(CL) && /matching_pending/.test(CL));
  check("create-lead uses durable rate limiter", /consume_api_rate_limit/.test(CL) && /RATE_LIMIT_SECRET/.test(CL));
  check("create-lead has no in-memory rate bucket", !/new Map\(\)|rateBuckets|rateAllowed/.test(CL));
}

// ---------------------------------------------------------------- ENDPOINTS
section("ENDPOINTS");
for (const key of ["accept", "decline"]) {
  const s = read(key);
  if (!s) { skip(`${FILES[key]} checks`, "file missing"); continue; }
  check(`${FILES[key]}: UUID validation`, /UUID_RE\.test\(leadId\)/.test(s));
  check(`${FILES[key]}: verifies JWT`, /auth\.getUser\(token\)/.test(s));
  check(`${FILES[key]}: identity from auth_id`, /eq\("auth_id", user\.id\)/.test(s));
  check(`${FILES[key]}: rejects mismatched id`, /identity_mismatch/.test(s));
  check(`${FILES[key]}: no direct GHL`, !/leadconnectorhq|GHL_HOMEOWNER_MATCHED/.test(s));
}
const A = read("accept");
if (A) check("lead-accept: charged_cents positive", /Math\.abs\(/.test(A));

const W = read("workflow");
if (!W) skip("contractor-workflow checks", "file missing");
else {
  check("workflow: POST only", /method !== "POST"/.test(W));
  check("workflow: server signature validation", /LOOKS_LIKE_NAME/.test(W));
  check("workflow: server timestamp", /agreement_accepted_at = new Date/.test(W));
  check("workflow: server IP", /x-forwarded-for/.test(W));
  check("workflow: server user agent", /agreement_accepted_user_agent/.test(W));
  check("workflow: server agreement version", /AGREEMENT_VERSION = "v2"/.test(W));
  check("workflow: conditional on prior status", /\.eq\("status", contractor\.status\)/.test(W));
  check("workflow: re-reads on race", /select\("status"\)\.eq\("id", contractor\.id\)/.test(W));
  check("workflow: deletion idempotent", /skipIf/.test(W));
  check("workflow: 409 on real conflict", /status_conflict/.test(W) && /status\(409\)/.test(W));
  check("workflow: no Active/Suspended transition", !/to: "Active"|to: "Suspended"/.test(W));
  check("workflow: no direct GHL", !/leadconnectorhq|GHL_REVIEW_WEBHOOK/.test(W));
}

const ADoc = read("adminDocument");
if (!ADoc) skip("admin document URL checks", "file missing");
else {
  check("admin document endpoint requires admin auth", /requireAdmin/.test(ADoc));
  check("admin document endpoint uses short-lived signed URL", /createSignedUrl\(objectPath,300\)/.test(ADoc));
  check("admin document endpoint rejects public URL paths", /\^https\?:\\\/\\\//.test(ADoc));
  check("admin document endpoint scopes license to contractor", /eq\("contractor_id",contractorId\)/.test(ADoc));
}

const LD = read("leadDispute");
if (!LD) skip("lead-dispute checks", "file missing");
else {
  check("lead-dispute: verifies JWT", /auth\.getUser\(token\)/.test(LD));
  check("lead-dispute: derives contractor from auth_id", /eq\("auth_id",user\.id\)/.test(LD));
  check("lead-dispute: validates lead UUID", /UUID_RE\.test\(leadId\)/.test(LD));
  check("lead-dispute: reason allowlist", /REASONS = new Set/.test(LD));
  check("lead-dispute: derives accepted debit server-side", /lead_offers/.test(LD) && /transaction_id/.test(LD) && /eq\("status","accepted"\)/.test(LD));
  check("lead-dispute: enforces seven-day window", /DISPUTE_WINDOW_MS = 7 \* 24 \* 60 \* 60 \* 1000/.test(LD));
  check("lead-dispute: duplicate debit guarded", /dispute_already_filed/.test(LD) && /debit_transaction_id/.test(LD));
  check("lead-dispute: does not trust client contractor/debit id", !/body\.contractor_id|body\.debit_transaction_id/.test(LD));
}

const ADD = read("adminDisputeDecision");
if (!ADD) skip("admin-dispute-decision checks", "file missing");
else {
  check("admin dispute decision: requires admin auth", /requireAdmin/.test(ADD));
  check("admin dispute decision: validates UUID", /UUID_RE\.test\(disputeId\)/.test(ADD));
  check("admin dispute decision: decision allowlist", /\["approved","rejected"\]/.test(ADD));
  check("admin dispute decision: delegates to DB RPC", /rpc\("decide_lead_dispute"/.test(ADD));
}

const WK = read("worker");
if (!WK) skip("worker checks", "file missing");
else {
  check("worker: secret required", /NOTIFICATION_WORKER_SECRET/.test(WK));
  check("worker: timing-safe compare", /timingSafeEqual/.test(WK));
  check("worker: claims via RPC", /claim_notifications/.test(WK));
  check("worker: AbortController timeout", /AbortController/.test(WK));
  check("worker: retries 429 and 5xx", /429/.test(WK) && /status >= 500/.test(WK));
  check("worker: backoff with jitter", /jitter/i.test(WK));
  check("worker: dead-letters", /"dead"/.test(WK));
  check("worker: relevance gate", /checkRelevance/.test(WK));
  check("worker: lifecycle relevance", /LIFECYCLE_EXPECTED_STATUS/.test(WK));
  check("worker: lead_submitted relevance", /job\.event_type === "lead_submitted"/.test(WK));
  check("worker: settles via lease RPC", /settle_notification/.test(WK));
  check("worker: single events env var", /GHL_SSP_EVENTS_WEBHOOK/.test(WK));
  check("worker: does not log full payload", !/console\.log\(.*payload/.test(WK));
  check("worker: relevance query errors retry, not obsolete",
    /relevance_query_failed/.test(WK) && /throw new Error/.test(WK));
  check("worker: stats only count successful settles",
    /if \(settled\) stats\.sent\+\+/.test(WK) && /if \(settled\) stats\.retried\+\+/.test(WK));
}

const CC = read("createContractor");
if (!CC) skip("create-contractor checks", "file missing");
else {
  check("create-contractor: no direct GHL", !/leadconnectorhq/.test(CC));
  check("create-contractor: no tier write", !/membership_tier:\s*planName/.test(CC));
  // Strip comments before scanning: the file documents what it fixed.
  const CCcode = CC.replace(/^\s*\/\/.*$/gm, "");
  check("create-contractor: no Math.random credentials", !/Math\.random/.test(CCcode));
  check("create-contractor: uses crypto.randomBytes", /crypto\.randomBytes/.test(CCcode));
  check("create-contractor: no ilike identity match", !/\.ilike\(/.test(CCcode));
  check("create-contractor: does not return action_link", !/action_link/.test(CCcode));
  check("create-contractor: durable rate limited", /consume_api_rate_limit/.test(CCcode) && /RATE_LIMIT_SECRET/.test(CCcode));
  check("create-contractor: no in-memory rate bucket", !/new Map\(\)|rateLimited|RATE_WINDOW_MS/.test(CCcode));
  check("create-contractor: rolls back orphan auth user", /admin\.deleteUser/.test(CCcode));
  check("create-contractor: does not delete auth after contractor commit",
    /createdContractorId/.test(CCcode) && /createdAuthId && !createdContractorId/.test(CCcode));
  check("create-contractor: licences to proper table", /contractor_licenses/.test(CCcode));
  check("create-contractor: errors return 5xx", /status\(500\)/.test(CCcode));
}


const CH = read("checkout");
if (!CH) skip("create-checkout-session checks", "file missing");
else {
  const code = CH.replace(/^\s*\/\/.*$/gm, "");
  check("checkout: verifies JWT", /auth\.getUser\(token\)/.test(code));
  check("checkout: identity from auth_id", /eq\("auth_id", user\.id\)/.test(code));
  check("checkout: Active contractor required", /contractor\.status !== "Active"/.test(code));
  check("checkout: fixed wallet presets", /10000, 25000, 50000/.test(code));
  check("checkout: payment mode only", /mode: "payment"/.test(code));
  check("checkout: no subscription mode", !/mode:\s*["']subscription["']/.test(code));
  check("checkout: no Basic Pro Elite model", !/\bBasic\b|\bPro\b|\bElite\b/.test(code));
  check("checkout: wallet metadata", /purpose: "wallet_topup"/.test(code) && /ssp_contractor_id/.test(code));
  check("checkout: server stores Stripe customer", /stripe_customer_id/.test(code));
  check("checkout: returns Stripe URL not client secret", /session\.url/.test(code) && !/client_secret/.test(code));
}

const SW = read("stripeWebhook");
if (!SW) skip("stripe-webhook checks", "file missing");
else {
  const code = SW.replace(/^\s*\/\/.*$/gm, "");
  check("stripe webhook: raw body parser disabled", /bodyParser: false/.test(code));
  check("stripe webhook: verifies signature", /constructEvent/.test(code));
  check("stripe webhook: wallet events only", /wallet_topup/.test(code));
  check("stripe webhook: no subscription lifecycle", !/customer\.subscription\.deleted|invoice\.payment|stripe_subscription_id/.test(code));
  check("stripe webhook: never mutates contractor status", !/status:\s*["']/.test(code));
  check("stripe webhook: calls credit_wallet", /rpc\("credit_wallet"/.test(code));
  check("stripe webhook: topup type", /p_type: "topup"/.test(code));
  check("stripe webhook: idempotency ref is payment intent", /session\.payment_intent/.test(code) && /p_stripe_ref: stripeRef/.test(code));
  check("stripe webhook: processing failure returns 500", /status\(500\).*processing_failed/s.test(code));
  check("stripe webhook: validates amount metadata", /amount_mismatch/.test(code));
  check("stripe webhook: validates Stripe customer binding", /stripe_customer_mismatch/.test(code));
}

// -------------------------------------------------------------------- SQL
section("SQL");
const SEC = read("sqlSecurity");
if (!SEC) skip("security migration checks", "file missing");
else {
  check("revokes broad contractor UPDATE", /revoke insert, update, delete on public\.contractors/.test(SEC));
  check("revokes broad license UPDATE", /revoke insert, update, delete on public\.contractor_licenses/.test(SEC));
  check("no table-wide license INSERT grant",
    !/grant insert on public\.contractor_licenses to authenticated/.test(SEC));
  check("license contractor_id INSERT granted", /'contractor_id'/.test(SEC));
  check("license contractor_id UPDATE excluded (immutable)",
    /lic_update text\[\] := array\[\s*\n\s*'trade_category'/.test(SEC));
  check("agreement_accepted_user_agent column", /agreement_accepted_user_agent text/.test(SEC));
  check("bucket forced private", /update storage\.buckets set public = false/.test(SEC));
  check("drops legacy storage policies", /"Contractors upload to own folder"/.test(SEC));
  check("insurance reset trigger", /trg_reset_insurance_verification/.test(SEC));
  check("services_detail is jsonb", /services_detail\s+jsonb/.test(SEC));
  check("type assertion queries present", /TYPE ASSERTIONS/.test(SEC));
  check("bucket size limit", /file_size_limit = 10485760/.test(SEC));
  check("bucket mime allowlist", /allowed_mime_types = array\['application\/pdf'/.test(SEC));
  check("storage update has WITH CHECK",
    /"contractor updates own docs"[\s\S]{0,400}with check/.test(SEC));
  check("license reset trigger", /trg_reset_license_verification/.test(SEC));
  check("license insert forced unverified", /TG_OP = 'INSERT'/.test(SEC));
  check("explicit license RLS per command",
    /"lic select own"/.test(SEC) && /"lic insert own"/.test(SEC) &&
    /"lic update own"/.test(SEC) && /"lic delete own"/.test(SEC));
  check("license update has WITH CHECK (no re-parenting)",
    /"lic update own"[\s\S]{0,400}with check/.test(SEC));
}

const OB = read("sqlOutbox");
if (!OB) skip("outbox migration checks", "file missing");
else {
  check("outbox table", /create table if not exists public\.notification_outbox/.test(OB));
  // Postgres grants EXECUTE to PUBLIC by default; revoking anon/authenticated
  // alone leaves the function callable. PUBLIC must be named explicitly.
  check("enqueue revokes PUBLIC",
    /revoke all on function public\.enqueue_notification[\s\S]{0,160}from public/.test(OB));
  check("claim revokes PUBLIC",
    /revoke all on function public\.claim_notifications[\s\S]{0,120}from public/.test(OB));
  check("settle revokes PUBLIC",
    /revoke all on function public\.settle_notification[\s\S]{0,160}from public/.test(OB));
  check("service_role granted execute", /grant execute on function public\.claim_notifications/.test(OB));
  check("has_function_privilege assertions present", /has_function_privilege/.test(OB));
  check("lease-conditioned settle RPC", /settle_notification/.test(OB) && /locked_by = p_worker/.test(OB));
  check("lifecycle key uses per-transition nonce", /gen_random_uuid\(\)::text/.test(OB));
  check("idempotency_key unique", /idempotency_key\s+text\s+not null unique/.test(OB));
  check("status constrained", /check \(status in \('pending','processing','retry','sent','obsolete','dead'\)\)/.test(OB));
  check("lease columns", /locked_at/.test(OB) && /locked_by/.test(OB));
  check("error bounded", /outbox_error_bounded/.test(OB));
  check("claim index", /idx_outbox_claim/.test(OB));
  check("browser has no access", /revoke all on public\.notification_outbox from anon, authenticated/.test(OB));
  check("claim uses SKIP LOCKED", /for update skip locked/.test(OB));
  check("stale lease reclaim", /status = 'processing'[\s\S]{0,200}locked_at < now\(\)/.test(OB));
  for (const t of ["emit_contractor_created", "emit_contractor_status_event", "emit_lead_submitted",
                   "emit_lead_offer_created", "emit_lead_accepted", "emit_lead_unmatched"]) {
    check(`trigger fn ${t}`, new RegExp(t).test(OB));
  }
  // Pre-accept privacy: the offer payload must not name any PII field.
  const offerFn = OB.slice(OB.indexOf("emit_lead_offer_created"), OB.indexOf("emit_lead_accepted"));
  for (const pii of ["homeowner_name", "homeowner_phone", "homeowner_email",
                     "homeowner_address", "'description'"]) {
    check(`lead_offer_created omits ${pii}`, !offerFn.includes(pii));
  }
  check("lead_submitted idempotent by lead", /lead_submitted:v1:/.test(OB));
  check("lifecycle keys do not permanently block",
    /v_type \|\| ':v1:' \|\| new\.id::text \|\| ':' \|\| gen_random_uuid\(\)::text/.test(OB));
}


const RL = read("sqlRateLimits");
if (!RL) skip("API rate-limit migration checks", "file missing");
else {
  check("rate-limit table created", /create table if not exists public\.api_rate_limits/.test(RL));
  check("rate-limit raw keys are hashed shape", /api_rate_limit_hash_shape/.test(RL));
  check("rate-limit table browser access revoked", /revoke all on public\.api_rate_limits from public, anon, authenticated/.test(RL));
  check("rate-limit RPC security definer", /consume_api_rate_limit[\s\S]{0,500}security definer/i.test(RL));
  check("rate-limit RPC revokes PUBLIC", /consume_api_rate_limit[\s\S]{0,1200}from public, anon, authenticated/.test(RL));
  check("rate-limit RPC service-role only", /grant execute on function public\.consume_api_rate_limit[\s\S]{0,180}to service_role/.test(RL));
  check("rate-limit upsert is atomic", /on conflict \(scope, key_hash, window_start\)[\s\S]{0,240}hit_count = public\.api_rate_limits\.hit_count \+ 1/.test(RL));
}

const WT = read("sqlWalletTopup");
if (!WT) skip("wallet top-up migration checks", "file missing");
else {
  check("wallet topup migration canonicalizes credit_wallet", /create or replace function public\.credit_wallet/.test(WT));
  check("wallet topup adds ledger idempotency key", /add column if not exists idempotency_key/.test(WT) && /wallet_tx_idempotency_key_once/.test(WT));
  check("wallet topup requires deterministic key for topup/promo/bonus", /idempotency_key required for credit type/.test(WT));
  check("wallet topup canonical signature has idempotency parameter", /p_idempotency_key text default null/.test(WT));
  check("wallet topup unique Stripe reference", /wallet_tx_topup_stripe_ref/.test(WT));
  check("wallet topup RPC revokes PUBLIC", /from public, anon, authenticated/.test(WT));
  check("wallet topup RPC service-role only", /grant execute on function public\.credit_wallet[\s\S]{0,180}to service_role/.test(WT));
  check("Stripe customer remains server-owned", /revoke update \(stripe_customer_id\)/.test(WT));
  check("wallet topup privilege assertions", /has_function_privilege/.test(WT));
}

const FP = read("sqlFoundingPromo");
if (!FP) skip("Founding 25 promo migration checks", "file missing");
else {
  check("Founding 25 amount is exactly $250", /25000/.test(FP));
  check("Founding 25 deterministic idempotency key", /founding25:v1:/.test(FP));
  check("Founding 25 uses wallet idempotency key", /idempotency_key = v_key/.test(FP));
  check("Founding 25 globally capped at 25", /v_count >= 25/.test(FP) && /founding25_full/.test(FP));
  check("Founding 25 allocation concurrency serialized", /pg_advisory_xact_lock/.test(FP));
  check("activation requires verified current insurance", /insurance_not_verified/.test(FP) && /insurance_expired_or_missing/.test(FP));
  check("activation requires verified selected regulated trades", /required_license_not_verified/.test(FP) && /hvac.*plumbing.*electrical/i.test(FP));
  check("generic activate function service-only", /activate_contractor/.test(FP) && /grant execute on function public\.activate_contractor/.test(FP));
  check("Founding 25 uses promo_grant", /'promo_grant'/.test(FP));
  check("Founding 25 service-role only", /from public, anon, authenticated/.test(FP) && /to service_role/.test(FP));
  check("Founding 25 atomic approve function", /approve_founding25_contractor/.test(FP) && /status = 'Active'/.test(FP));
}

const DS = read("sqlDisputes");
if (!DS) skip("dispute decision migration checks", "file missing");
else {
  check("dispute decision requires lead_disputes", /to_regclass\('public\.lead_disputes'\)/.test(DS));
  check("dispute decision requires reverse_debit", /to_regprocedure\('public\.reverse_debit\(uuid,text,text\)'\)/.test(DS));
  check("dispute decision is SECURITY DEFINER", /decide_lead_dispute[\s\S]{0,500}security definer/i.test(DS));
  check("dispute decision locks row", /lead_disputes where id=p_dispute_id for update/.test(DS));
  check("dispute decision validates debit relationship", /v_charge\.contractor_id<>v_d\.contractor_id/.test(DS) && /v_charge\.lead_id<>v_d\.lead_id/.test(DS));
  check("approved dispute uses exact reverse_debit", /public\.reverse_debit\(v_d\.debit_transaction_id/.test(DS));
  check("approved dispute records restored splits", /restored_promo_cents=abs/.test(DS) && /restored_paid_cents=abs/.test(DS));
  check("dispute decision is idempotent", /if v_d\.decision is not null/.test(DS));
  check("dispute decision revokes PUBLIC", /from public,anon,authenticated/.test(DS));
  check("dispute decision service-role only", /grant execute on function public\.decide_lead_dispute[\s\S]{0,140}to service_role/.test(DS));
  check("dispute decision privilege assertions", /has_function_privilege/.test(DS));
}

// ------------------------------------------------------------- SYNTAX
section("SYNTAX");
for (const key of ["createLead", "accept", "decline", "workflow", "worker", "createContractor", "adminAuth", "adminData", "adminUpdate", "adminDocument", "leadDispute", "adminDisputeDecision", "legacyLeadApi", "legacyPricingApi", "legacyAdminConfigApi", "checkout", "stripeWebhook", "taxonomy", "publicConfig"]) {
  const p = path.join(ROOT, FILES[key]);
  if (!fs.existsSync(p)) { skip(`node --check ${FILES[key]}`, "missing"); continue; }
  try { execFileSync("node", ["--check", p], { stdio: "pipe" }); check(`node --check ${FILES[key]}`, true); }
  catch (e) { check(`node --check ${FILES[key]}`, false, String(e.stderr || e).slice(0, 200)); }
}
if (D) {
  const blocks = [...D.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  blocks.forEach((b, i) => {
    if (!b.trim()) return;
    const tmp = path.join(require("os").tmpdir(), `ssp_block_${i}.js`);
    fs.writeFileSync(tmp, b);
    try { execFileSync("node", ["--check", tmp], { stdio: "pipe" }); check(`inline script block ${i}`, true); }
    catch (e) { check(`inline script block ${i}`, false, String(e.stderr || e).slice(0, 200)); }
  });
}

if (H) {
  const blocks = [...H.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  blocks.forEach((b, i) => {
    if (!b.trim()) return;
    const tmp = path.join(require("os").tmpdir(), `ssp_home_block_${i}.js`);
    fs.writeFileSync(tmp, b);
    try { execFileSync("node", ["--check", tmp], { stdio: "pipe" }); check(`homepage inline script block ${i}`, true); }
    catch (e) { check(`homepage inline script block ${i}`, false, String(e.stderr || e).slice(0, 200)); }
  });
}
if (I) {
  const blocks = [...I.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  blocks.forEach((b, i) => {
    if (!b.trim()) return;
    const tmp = path.join(require("os").tmpdir(), `ssp_intake_block_${i}.js`);
    fs.writeFileSync(tmp, b);
    try { execFileSync("node", ["--check", tmp], { stdio: "pipe" }); check(`intake inline script block ${i}`, true); }
    catch (e) { check(`intake inline script block ${i}`, false, String(e.stderr || e).slice(0, 200)); }
  });
}

const ADHTML = read("adminDashboard");
if (ADHTML) {
  const blocks = [...ADHTML.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  blocks.forEach((b, i) => {
    if (!b.trim()) return;
    const tmp = path.join(require("os").tmpdir(), `ssp_admin_block_${i}.js`);
    fs.writeFileSync(tmp, b);
    try { execFileSync("node", ["--check", tmp], { stdio: "pipe" }); check(`admin inline script block ${i}`, true); }
    catch (e) { check(`admin inline script block ${i}`, false, String(e.stderr || e).slice(0, 200)); }
  });
}

// ------------------------------------------------------------- FINGERPRINTS
section("FILE FINGERPRINTS");
for (const [key, rel] of Object.entries(FILES)) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { console.log(`  MISSING  ${rel}`); continue; }
  const buf = fs.readFileSync(p);
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  const lines = buf.toString("utf8").split("\n").length;
  console.log(`  ${rel}`);
  console.log(`      sha256 ${sha}`);
  console.log(`      lines  ${lines}   bytes ${buf.length}`);
}

// ------------------------------------------------------------- SUMMARY
console.log(`\n${"=".repeat(58)}`);
console.log(`PASS ${PASS}   FAIL ${FAIL}   SKIP ${SKIP}`);
if (SKIP > 0) console.log("\nRELEASE GATE: a SKIP on a mandatory artifact is a FAILURE.");
if (FAIL) {
  console.log("\nFAILURES:");
  failures.forEach(f => console.log("  - " + f));
}
console.log("\nSTATIC ONLY. This proves nothing about the live database.");
console.log("Live privilege and REST tests are a separate, manual step.");
console.log("=".repeat(58));
// Green requires zero failures AND zero skips.
process.exit(FAIL || SKIP ? 1 : 0);