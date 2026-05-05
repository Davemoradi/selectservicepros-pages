# SSP V2 — Handoff for next chat session (May 5)

**Date:** May 5, 2026 (end of session)
**Last code commit:** `f4510d1` — "Phase 0.4: fix Stripe customer race condition"
**This session's commit:** adds test scripts + this doc; no source code changes.
**Supersedes (but does not replace):** `SESSION-HANDOFF-APR29.md`. The April 29 doc is still accurate for everything that happened up to that date; this one captures what happened on May 5.

---

## TL;DR

Phase 0.4 fix has been **verified PASS in production**. While verifying it, we surfaced a separate deployment-config concern about which Stripe account Vercel was using — that's now resolved (it's the right account), but we rotated test keys along the way and one webhook config still needs eyeballing.

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

### Test scripts (committed this session)

- `scripts/test-0.4-race-with-precreate.ps1` — the **definitive PASS test**. Run with: `powershell -File scripts\test-0.4-race-with-precreate.ps1`
- `scripts/test-0.4-race.ps1` — earlier smoke-test variant **without** customer pre-creation. Returns INCONCLUSIVE because Stripe's subscription-mode Checkout doesn't eagerly create Customers at session creation, so `customers list` finds nothing and both branches behave identically. Kept as a reference for the methodology evolution; not the script to use for actual verification.

---

## Stripe account discovery

### Confirmed: SSP runs on `acct_1T9qddKBnGD4DieS`

Display name in the Stripe Dashboard: **"Select Service Pro"** (singular, no S — known typo in the account name; not a different account from "Select Service Pros"). Verified via:
- Stripe CLI auth landing on `acct_1T9qddKBnGD4DieS`
- Vercel's `STRIPE_SECRET_KEY` first 12 chars matching that account ID
- Production Checkout sessions returning `branding_settings.display_name: "Select Service Pro"`

CLI and Vercel are now confirmed aligned on the same test-mode account.

### Test secret keys were rotated mid-session — TWO accounts

While diagnosing, the user rotated the test secret keys for **both**:
- The **Select Service Pro** test account (`acct_1T9qddKBnGD4DieS`)
- The **SHW Contractors** test account (separate Stripe account; sister business)

Implication: any tooling, scripts, or configs that had old test keys cached needs to re-pull. We re-authenticated the Stripe CLI; Vercel was already updated (the user manually rotated `STRIPE_SECRET_KEY` in Vercel env before this verification ran).

### Vercel `STRIPE_SECRET_KEY` is manually-set, not marketplace-integration

The user confirmed Vercel's `STRIPE_SECRET_KEY` is configured by hand (env var directly), **not** via the Stripe-Vercel marketplace integration. This matters because:
- Manual keys do **not** auto-rotate when Stripe rotates them on their side
- After the test-account rotation, the user had to manually update Vercel's env var
- Future rotations will require the same manual update — easy to forget

Worth a calendar reminder around `2026-08-03` (CLI key expiry; Stripe also rotates around that timeframe).

### `STRIPE_WEBHOOK_SECRET` — still needs verification

We confirmed `STRIPE_SECRET_KEY` belongs to Select Service Pro. We did **not** verify the same for `STRIPE_WEBHOOK_SECRET`. If that webhook signing secret was issued by a different Stripe account (e.g., SHW Contractors) than the one creating the Checkout sessions, then:
- `api/stripe-webhook.js` would fail Stripe signature verification on every event from the SSP account
- `checkout.session.completed` events would never be processed
- Contractors who pay would never be activated in Supabase

**Action item for next session:**
1. In the Vercel dashboard, reveal `STRIPE_WEBHOOK_SECRET`. Note the first ~10 chars (they look like `whsec_...` and don't directly encode the account ID, so a quick visual won't be enough).
2. In the Stripe Dashboard for `acct_1T9qddKBnGD4DieS`, go to **Developers → Webhooks**. Find the endpoint configured for `https://www.selectservicepros.com/api/stripe-webhook`. Click "Reveal signing secret". Compare to the Vercel value.
3. If they match → Great, no action.
4. If they differ → need to either reconfigure the webhook endpoint in the right Stripe account, or update Vercel to use the right secret. **Until this is checked, treat any "checkout completed but contractor row not created" report as evidence this is broken.**

---

## CLI profile cleanup (this session)

After the Stripe CLI re-auth, two profiles existed in `~/.config/stripe/config.toml`:
- `[default]` — fresh keys (live ends `vRFs`, test ends `Lcoso`)
- `[select service pro]` — old/rotated keys (live ends `8i8q`, test ends `j6KO`)

The duplicate profile was removed at the end of this session via:
```
stripe config --unset --project-name "select service pro" test_mode_api_key
stripe config --unset --project-name "select service pro" live_mode_api_key
```

Verified `[default]` is now the only active profile.

---

## Tooling installed this session (Windows)

- **Scoop** — installed at `C:\Users\Davidm\scoop\` (extras bucket added)
- **Stripe CLI** — installed via winget (`Stripe.StripeCLI`), version 1.40.9. Path: `C:\Users\Davidm\AppData\Local\Microsoft\WinGet\Packages\Stripe.StripeCli_*\stripe.exe`
- **PowerShell execution policy** — set to `RemoteSigned` (CurrentUser scope) so scoop's bootstrap could run

**Not installed this session:**
- **Vercel CLI** — not in winget; would need Node.js + `npm i -g vercel`. Skipped because the env-var question was answered via Vercel dashboard instead. Install if/when needed for Phase 1.2 (next-question.js wiring) or any local `vercel dev` work.

---

## What to do next session

### Step 1 — Quick context check
Read `CLAUDE.md`, `docs/V2-PLAN.md`, `docs/V2-SCHEMA.md`, this doc, and `SESSION-HANDOFF-APR29.md` (older but still relevant for May 5 setup).

### Step 2 — Verify `STRIPE_WEBHOOK_SECRET`
See "STRIPE_WEBHOOK_SECRET — still needs verification" above. ~5 min in two browser tabs.

### Step 3 — Choose next Phase 0 item
- **0.2** (pricing standardization) — pure code, ~1 hour. Recommended next per V2-PLAN.
- **0.3** (Stripe Customer Portal) — needs Stripe Dashboard config first, ~1.5 hours. Note: now that we've confirmed which Stripe account is canonical (`acct_1T9qddKBnGD4DieS`), the Portal config can be done in that account specifically.
- **`lead-response.html` decision** — needs the GHL template check (still pending from April 29).

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
3. Manual `STRIPE_SECRET_KEY` setup in Vercel is a known operational quirk (not switching to Stripe-Vercel marketplace integration), so we own the rotation cadence.
4. Vercel CLI install was deferred — not blocking any active work, install on demand later.
