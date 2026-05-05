# SSP V2 — Handoff for next chat session (May 5)

**Date:** May 5, 2026 (end of session)
**Last code commit:** `f4510d1` — "Phase 0.4: fix Stripe customer race condition"
**This session's commits:** `1499adf` (test scripts + this doc); the next commit will be this doc's update with post-test infra fixes. No source code changes either way.
**Supersedes (but does not replace):** `SESSION-HANDOFF-APR29.md`. The April 29 doc is still accurate for everything that happened up to that date; this one captures what happened on May 5.

---

## TL;DR

Phase 0.4 fix has been **verified PASS in production**. The verification surfaced and forced fixes for three separate upstream deployment problems:

1. **Vercel's `STRIPE_SECRET_KEY` was pointing at the wrong Stripe account** — SHW Contractors (`acct_1T9qdkKBOgn1FLAE`) instead of SSP (`acct_1T9qddKBnGD4DieS`).
2. **The SSP Stripe sandbox had no webhook endpoint registered** for `/api/stripe-webhook`.
3. **`STRIPE_WEBHOOK_SECRET` was missing from Vercel entirely** — `api/stripe-webhook.js` would have rejected every event with a signature-verification failure even if events had been routed to it.

All three are fixed today. Webhook delivery is end-to-end verified (`stripe trigger checkout.session.completed` → 200 OK at `/api/stripe-webhook`). Test secret keys for **both** SSP and SHW Contractors accounts were rotated mid-session as part of the cleanup.

---

## Phase 0 progress (cumulative)

| # | Task | Status |
|---|---|---|
| 0.1 | Fix malformed GHL webhook URL | ✅ Done, `dbbab7b`, pushed |
| 0.5 | Delete dead duplicate root files | ✅ Done in `dbbab7b` |
| 0.5 | `lead-response.html` (root) | ⏸️ HELD — needs GHL email-template check |
| 0.6 | Delete BD dead code | ✅ Done in `dbbab7b` |
| 0.7 | Delete orphaned FAQ pages | ✅ Done in `dbbab7b` |
| 0.4 | Fix Stripe customer race condition | ✅ Code in `f4510d1` |
| 0.4 | **Test the fix end-to-end** | ✅ **PASS** (this session — see below) |
| — | Vercel-Stripe account alignment | ✅ Fixed today |
| — | Stripe webhook endpoint registration | ✅ Created today |
| — | `STRIPE_WEBHOOK_SECRET` configuration | ✅ Added today; delivery verified 200 |
| 0.2 | Standardize `platform_config.pricing` | ⏳ Not started |
| 0.3 | Wire up Stripe Customer Portal | ⏳ Not started |

---

## Phase 0.4 — verification PASS

The fix in `api/create-checkout-session.js` (commit `f4510d1`) was verified against the production endpoint without browser-based payment completion.

### Methodology

The race condition only manifests when at least one Stripe Customer object already exists for the email — the bug is that without the fix, a second checkout creates a duplicate. So the test pre-creates a Customer via the Stripe CLI, then POSTs twice to `/api/create-checkout-session` with that email (Pro then Elite), and inspects:

- How many Stripe Customers exist for the email afterwards (expect 1, the pre-created one)
- Whether each session's `.customer` field references the pre-created customer ID (expect yes for both)

If the fix didn't engage, we'd see 2 or 3 customers and at least one session with `customer: null` and `customer_email: <addr>` instead.

### Results

```
Pre-created customer ID:    cus_USl29gmR8pNLhO
Customer count after POSTs: 1
Session 1 customer field:   cus_USl29gmR8pNLhO
Session 2 customer field:   cus_USl29gmR8pNLhO
RESULT: PASS - fix engaged. Both sessions reuse the pre-created customer.
```

Both sessions also showed `customer_email: null`, confirming the conditional spread in `api/create-checkout-session.js` chose the `customer:` branch over `customer_email:`. The branding on the Checkout sessions (`display_name: "Select Service Pro"`) confirms they live in the same Stripe account our CLI was authenticated to.

### Test scripts (committed in `1499adf`)

- `scripts/test-0.4-race-with-precreate.ps1` — the **definitive PASS test**. Run with: `powershell -File scripts\test-0.4-race-with-precreate.ps1`
- `scripts/test-0.4-race.ps1` — earlier smoke-test variant **without** customer pre-creation. Returns INCONCLUSIVE because Stripe's subscription-mode Checkout doesn't eagerly create Customers at session creation, so `customers list` finds nothing and both branches behave identically. Kept as a reference for the methodology evolution; not the script to use for actual verification.

---

## Stripe account discovery and infrastructure fixes

### Canonical SSP account: `acct_1T9qddKBnGD4DieS`

Display name in the Stripe Dashboard: **"Select Service Pro"** (singular, no S — known typo in the account name; not a different account from "Select Service Pros"). Verified via:

- Stripe CLI auth landing on `acct_1T9qddKBnGD4DieS`
- Vercel's `STRIPE_SECRET_KEY` (post-fix, see below) first 12 chars matching that account ID
- Production Checkout sessions returning `branding_settings.display_name: "Select Service Pro"`

CLI and Vercel are now aligned on this account.

### Account mismatch discovered and fixed mid-session

Before this session, **Vercel's `STRIPE_SECRET_KEY` was set to a key from SHW Contractors (`acct_1T9qdkKBOgn1FLAE`)** — a separate test account from a sister Stripe entity, not SSP's own. That's why the precreate race test initially returned `resource_missing` errors when our CLI tried to retrieve sessions: the CLI was authed to SSP `acct_1T9qddKBnGD4DieS` but Vercel's deployed function was creating sessions in SHW's `acct_1T9qdkKBOgn1FLAE`.

The user updated Vercel's `STRIPE_SECRET_KEY` mid-session to point at the SSP account. Vercel auto-redeployed, and the precreate race test then passed cleanly.

**Why this had been wrong:** Vercel's `STRIPE_SECRET_KEY` is configured manually (env var directly), not via the Stripe-Vercel marketplace integration. Whoever originally set it pasted a key from the wrong account. Manual keys do not auto-rotate or auto-correct.

### Test secret keys rotated for both accounts

While diagnosing, the user rotated the test secret keys for **both**:

- **Select Service Pro** (`acct_1T9qddKBnGD4DieS`) — the canonical SSP test account
- **SHW Contractors** (`acct_1T9qdkKBOgn1FLAE`) — sister test account, now confirmed not used by SSP infrastructure

Implication: any tooling, scripts, or configs that had old test keys cached needed to re-pull. Stripe CLI was re-authenticated this session. Vercel was updated by hand (since it's not on the marketplace integration). Calendar reminder for `2026-08-03` covers the next CLI key expiry; Stripe also tends to rotate around that timeframe.

### Webhook endpoint created in SSP sandbox today

Before this session, the SSP sandbox (`acct_1T9qddKBnGD4DieS`) **did not have a webhook endpoint** registered for `https://www.selectservicepros.com/api/stripe-webhook`. Whatever endpoint had previously been registered must have been on the SHW Contractors account (which won't help because Vercel's function now talks to SSP).

Today the user created a fresh endpoint in SSP's Developers → Webhooks pointed at `/api/stripe-webhook`, subscribed to the **four** events `api/stripe-webhook.js` actually handles:

1. `checkout.session.completed`
2. `customer.subscription.deleted`
3. `invoice.payment_failed`
4. `invoice.payment_succeeded`

Anything else the handler logs as `Unhandled event type:` and records `result = 'ignored:<type>'` in the `stripe_events` audit table — so subscribing to extra events would be wasted dispatches.

### `STRIPE_WEBHOOK_SECRET` was missing from Vercel — added today

Before this session, **Vercel had no `STRIPE_WEBHOOK_SECRET` env var at all**. `api/stripe-webhook.js` lines 50–61 short-circuit with `Server misconfigured` if it's missing, so even if events had reached the endpoint, signature verification (and thus all event processing) would have been a 500.

The user added the new endpoint's signing secret to Vercel as `STRIPE_WEBHOOK_SECRET` and redeployed.

### Webhook delivery verified end-to-end

After the redeploy, fired a synthetic event from the CLI:

```
stripe trigger checkout.session.completed
```

Dashboard delivery status: **200 OK**. Signature verified, handler ran, response captured in Stripe's webhook logs. End-to-end webhook flow is now functional.

**Side-effect to expect (and clean up):** the synthetic event passes through the handler's race-fallback path and may have inserted a contractor row into Supabase with `first_name='Unknown'`, `last_name='Unknown'`, `membership_tier='Basic'`, `status='Pending Verification'`. A Supabase query is queued for next session to inspect and delete if present:

```sql
SELECT id, email, first_name, last_name, status, membership_tier, created_at
FROM contractors
WHERE created_at > NOW() - INTERVAL '30 minutes'
ORDER BY created_at DESC;
```

### LeadConnector (GHL) connected to SSP via Stripe Connect

Worth noting for future debugging: **GHL is connected to SSP's Stripe account via Stripe Connect**, so it auto-receives Stripe events (`customer.created`, `customer.subscription.created`, etc.) directly. This is **separate** from our `/api/stripe-webhook` handler — GHL is its own subscriber via Connect, not via a registered webhook endpoint.

This is benign for our flow:

- Connect-routed events go to GHL's Stripe app, not to `/api/stripe-webhook`
- Our handler only processes the four events explicitly subscribed to its own endpoint
- GHL's intake of `customer.*` events is what powers the existing CRM-side automations

If anyone notices Stripe events showing up in GHL without us having configured them: that's the Connect link, not a misconfiguration on our side.

---

## CLI profile cleanup (this session) — what actually worked

After the Stripe CLI re-auth, two profiles existed in `~/.config/stripe/config.toml`:

- `[default]` — fresh keys (live ends `vRFs`, test ends `Lcoso`)
- `[select service pro]` — old/rotated keys (live ends `8i8q`, test ends `j6KO`)

Two non-trivial issues with the obvious cleanup approach:

1. **`stripe config --unset` flag order matters.** The CLI's actual syntax (per `stripe config --help`) is `--unset <field-name>` where the field name is the value of the flag — so `stripe config --unset test_mode_api_key --project-name "select service pro"` works, but `stripe config --unset --project-name "select service pro" test_mode_api_key` is a silent no-op (it parses `--project-name` as the field-name argument).

2. **Even with correct syntax, `--unset` on a profile *changes the active default* to that profile.** Running `stripe config --unset test_mode_api_key --project-name "select service pro"` rewrote the top-level `project-name = 'default'` line to `project-name = 'select service pro'` as a side-effect — so subsequent `stripe ...` commands would default to a now-keyless profile and fail to authenticate.

The full clean-up actually performed:

1. `stripe config --unset test_mode_api_key --project-name "select service pro"` (correct syntax)
2. `stripe config --unset live_mode_api_key --project-name "select service pro"` (correct syntax)
3. **Direct edit** of `~/.config/stripe/config.toml`:
    - Restored the top-level `project-name = 'default'`
    - Deleted the residual `['select service pro']` section header and its remaining metadata fields (account_id, display_name, pub keys, etc. — `--unset` only removes the API keys it's explicitly told to)

Final state verified: only `[default]` remains, `project-name = 'default'`, fresh keys intact.

---

## Tooling installed this session (Windows)

- **Scoop** — installed at `C:\Users\Davidm\scoop\` (extras bucket added)
- **Stripe CLI** — installed via winget (`Stripe.StripeCLI`), version 1.40.9. Path: `C:\Users\Davidm\AppData\Local\Microsoft\WinGet\Packages\Stripe.StripeCli_*\stripe.exe`
- **PowerShell execution policy** — set to `RemoteSigned` (CurrentUser scope) so scoop's bootstrap could run

**Not installed this session:**

- **Vercel CLI** — not in winget; would need Node.js + `npm i -g vercel`. Skipped because the env-var question was answered via Vercel dashboard instead. Install if/when needed for Phase 1.2 (`next-question.js` wiring) or any local `vercel dev` work.

---

## What to do next session

### Step 1 — Quick context check
Read `CLAUDE.md`, `docs/V2-PLAN.md`, `docs/V2-SCHEMA.md`, this doc, and `SESSION-HANDOFF-APR29.md` (older but still relevant for the May 5 setup).

### Step 2 — Inspect / clean up the synthetic test contractor row
Run the Supabase query above and either confirm no row was inserted or delete the `Unknown/Unknown` row from the `stripe trigger` test. Don't proceed with anything else if the query shows multiple recent rows that aren't from the test — that would imply real signups during the test window and need investigation first.

### Step 3 — Choose next Phase 0 item
- **0.2** (pricing standardization) — pure code, ~1 hour. Recommended next per V2-PLAN. Note: April 29's live Supabase findings show `platform_config.pricing` is already in canonical PascalCase shape, so 0.2 simplifies to just making `save-pricing.js` and `admin-dashboard.html` write/read that shape consistently. No data migration needed.
- **0.3** (Stripe Customer Portal) — needs Stripe Dashboard config first, ~1.5 hours. Now that the canonical Stripe account is confirmed (`acct_1T9qddKBnGD4DieS`) and the webhook endpoint is in place, the Portal config can be done in that account specifically.
- **`lead-response.html` decision** — needs the GHL email-template check (still pending from April 29).

### Step 4 — Pending doc updates
The three live-Supabase findings from April 29 still need to land in `docs/V2-SCHEMA.md` and `docs/V2-PLAN.md`:

1. Email uniqueness: `contractors_email_key` exists (UNIQUE on `email`, **case-sensitive**, not `LOWER(email)` as documented)
2. `platform_config.pricing` is already in canonical PascalCase shape — Phase 0.2 simplifies to code-only changes
3. RLS policies have redundant pairs (cleanup task for Phase 1.4)

These are still aspirational doc updates; not done yet.

---

## Decisions made this session (do not relitigate)

1. The pre-create methodology is the canonical way to test 0.4 without a browser. The smoke-test variant is documentation-only.
2. CLI re-auth flow requires the user to explicitly say "authorized" (or equivalent) **after** clicking Allow in the browser, not before — the polling window is short and burns the pairing if `--complete` runs too early.
3. Manual `STRIPE_SECRET_KEY` setup in Vercel is a known operational quirk (not switching to Stripe-Vercel marketplace integration), so we own the rotation cadence. Same applies to `STRIPE_WEBHOOK_SECRET`.
4. Vercel CLI install was deferred — not blocking any active work, install on demand later.
5. SHW Contractors test account (`acct_1T9qdkKBOgn1FLAE`) is **not** part of SSP infrastructure. Any Stripe key starting with the prefix that account would generate is a misconfiguration if found in SSP env vars.
6. GHL receives Stripe events via Stripe Connect, not via a registered webhook endpoint. Don't subscribe `/api/stripe-webhook` to events solely because GHL needs them — GHL gets them through its Connect linkage automatically.
