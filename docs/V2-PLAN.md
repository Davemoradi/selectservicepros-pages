# SSP V2 Plan

This document is the v2 build plan for Select Service Pros. It supersedes any prior planning.

The plan is organized in four phases. **Phases 0 and 1 must be completed before any work on Phase 2+ begins.** Doing them out of order risks compounding bugs that get harder to fix as contractor volume grows.

---

## Guiding principles

1. **v1 is more built than it appears.** The contractor dashboard, signup, intake, and admin dashboard all exist as functional code. v2 is mostly **finishing what's unfinished and fixing what's silently broken**, not greenfield.
2. **Don't rebuild in Next.js until necessary.** The static-HTML setup works. Migrating is a Phase 3 task, not a Phase 0 task.
3. **Schema changes are expensive.** Always reflect them in `docs/V2-SCHEMA.md` first. Migrations get a SQL file checked into `migrations/`.
4. **Webhooks fail silently.** Always test the live webhook endpoint after any change to webhook URLs. Don't assume a 200 OK means the workflow ran.
5. **Stripe is the truth, your DB is the mirror.** Never query Stripe at runtime to answer "what plan is this contractor on" — always query Supabase. The webhook keeps Supabase in sync.

---

## Phase 0 — Critical fixes (1–2 days, ~5 hours)

These are landmines, not features. Do them first. They are not optional.

### 0.1 Fix malformed GHL webhook URL in `create-lead.js` *(5 min)*

**Bug:** Line 9 declares `GHL_WEBHOOK = "https://services.leadconnectorhq.com/hooks/a65106d8-9948-4122-9364-bddcc07aca5c"` — missing the sub-account ID and `webhook-trigger/` segment. Every lead creation tries to fire it, fails silently, generic CRM-sync workflow never runs.

**Fix:** Replace with the correct full URL:
```
https://services.leadconnectorhq.com/hooks/QfDToN545k1TOpFZa5AQ/webhook-trigger/a65106d8-9948-4122-9364-bddcc07aca5c
```

**Verify:** Submit a test lead. Check GHL contact creation log to confirm the contact was upserted. Check Vercel function logs to confirm the fetch returned 200.

### 0.2 Standardize `platform_config.pricing` shape *(1 hr)*

**Bug:** `create-lead.js` reads `pricing.Basic.perLead` (PascalCase, key `responseWindow`). `save-pricing.js` falls back to `pricing.basic.window` (lowercase, key `window`). If the DB has the wrong convention, leads get `lead_fee = 0` silently.

**Fix:**
1. Decide on canonical shape: **PascalCase tier names** (`Basic`/`Pro`/`Elite`) with keys `monthly`, `perLead`, `responseWindow`. Reasoning: matches `membership_tier` enum values used elsewhere.
2. Audit current `platform_config.pricing` row in Supabase SQL editor. Update it to canonical shape if needed.
3. Update `save-pricing.js` to write canonical shape.
4. Update `admin-dashboard.html` pricing form to read/write canonical shape.
5. Add a comment in `create-lead.js` and `save-pricing.js` linking to this doc as the canonical reference.

**Verify:** Update a price in admin dashboard. Submit a test lead. Check the `lead_fee` column has the new value.

### 0.3 Wire up Stripe Customer Portal *(1.5 hr total: 30 min Stripe + 1 hr code)*

**Gap:** Contractor dashboard's "Manage subscription" button is a toast demo. No way for a contractor to update their card, change plans, see invoice history, or cancel. They have to email support.

**Fix:**
1. **In Stripe Dashboard:** Settings → Billing → Customer Portal → Configure. Enable the features you want exposed (card update, plan switching, cancellation, invoice history). Set return URL to `https://www.selectservicepros.com/contractor-dashboard.html?tab=billing`. Save the published portal config.
2. **In code:** Add new endpoint `api/create-portal-session.js`:
   - Accepts `contractor_id` (validate JWT)
   - Looks up `stripe_customer_id` from contractors table
   - Calls `stripe.billingPortal.sessions.create({customer, return_url})`
   - Returns `{url}` for client to redirect to
3. **In contractor-dashboard.html:** Replace `toast('Stripe portal would open here')` with a real fetch to the new endpoint, then `window.location = url`.
4. While you're in there: also kill the upgrade/downgrade/cancel buttons that just toast — replace with "Manage subscription" links to the portal. The portal handles all of these.

**Verify:** Log in as a real contractor (test mode), click Manage subscription, confirm the Stripe portal loads, change a card, return to dashboard.

### 0.4 Fix Stripe customer race condition in `create-checkout-session.js` *(1 hr)*

**Bug:** Doesn't search for existing Stripe customer by email before creating a checkout session. If a contractor abandons one checkout and tries again, Stripe creates a duplicate customer with the same email. Webhook handler matches by email (not Stripe customer ID), so the second session's customer ID overwrites the first. Orphaned customer record in Stripe.

**Fix:** In `create-checkout-session.js`, before calling `stripe.checkout.sessions.create`:
```javascript
const existing = await stripe.customers.list({email: form.email, limit: 1});
const customerId = existing.data[0]?.id;

const session = await stripe.checkout.sessions.create({
  // ...
  ...(customerId ? {customer: customerId} : {customer_email: form.email}),
  // ...
});
```

**Verify:** Test the flow: start signup as Pro, abandon at Stripe checkout, restart as Elite with same email. Confirm only one Stripe customer exists with that email.

### 0.5 Delete dead duplicate root files *(30 min)*

Dead code is confusing and creates risk that the wrong file gets imported. Delete:

- `stripe-webhook.js` (root) — superseded by `api/stripe-webhook.js`. Vercel only routes `/api/`, so this never runs anyway.
- `zip-lookup.js` (root) — older copy without radius support.
- Decide on `lead-response.html`:
  - **If unused:** delete. The new flow uses `/api/lead-response.js` which serves its own HTML.
  - **If still linked from emails:** update the email templates to point at the API route, then delete the static page.

**Do not delete** `ssp-config.js` (root) — it's referenced by HTML pages. Instead delete `api/ssp-config.js` (the out-of-date one) after confirming nothing imports it server-side.

### 0.6 Remove BD dead code *(15 min)*

`api/bd-login.js` and `api/create-bd-account.js` proxy a Brilliant Directories CMS that's been replaced. Nothing in current HTML calls them. Delete both files.

### 0.7 Decide on `faq-homeowners.html` and `faq-contractors.html` *(15 min)*

These exist in root but aren't linked from any nav. Either:
- Add nav/footer links and ship them, OR
- Delete the files.

**Phase 0 Definition of Done:** All bugs above fixed. All dead code deleted. Phase 1 work can begin from a clean baseline.

---

## Phase 1 — Finish what's unfinished (Weeks 1–3)

These items make existing v1 features actually production-ready.

### 1.1 Real Billing tab in contractor dashboard *(1–2 days)*

Currently hard-codes `Pro` tier, `$99` monthly, `$29` per lead. Static "Apr 1 – Apr 30" period. None of it is real.

**Build:**
- Read `state.tierBadge` (or current `membership_tier` from contractors row) — show real tier name
- Read prices from `platform_config.pricing` (the standardized one from Phase 0.2)
- Show real billing-period dates from latest Stripe invoice (server endpoint to fetch)
- Real "next charge" date from Stripe subscription
- Working "Manage subscription" button (Phase 0.3)
- Remove the upgrade/downgrade/cancel buttons that toast — link to portal instead
- Show **historical lead charges this period** computed from `leads` table (sum of `lead_fee` where `assigned_contractor_id = me` AND `accepted_at` in current period)

### 1.2 Wire `next-question.js` to `intake-v2.html` OR remove it *(1 day to wire, 5 min to remove)*

The Anthropic Claude API endpoint exists, deployed, paying for cold starts. `intake-v2.html` doesn't call it.

**Decision:** Adaptive AI questions are a real differentiator and worth shipping. Wire it up.

**Build:** In `intake-v2.html` at Step 3 (currently a hard-coded pill list per category):
- Replace the hard-coded pills with a dynamic question card
- After Step 1 (category + ZIP), instead of jumping to Step 2 hardcoded fields, call `next-question.js` with `{category, zip, sessionId}`
- Render the returned question and accept response
- Continue calling until `done: true` or 5 questions hit (cap defined in `next-question.js`)
- Then proceed to Step 4 (urgency + free text) as today

**Note:** Owner has been excited about this feature for months. Quality of the AI questions matters — test thoroughly with multiple categories.

### 1.3 Implement actual cascading dispatch *(2–3 days)*

The "Elite gets 60-min window → Pro 45 → Basic 30" model exists in copy but not in code. Today the matcher picks one winner.

**Schema changes** (see V2-SCHEMA.md):
- New table `lead_matches` — one row per (lead, contractor) match with `tier`, `notified_at`, `responded_at`, `status`
- `leads.assigned_contractor_id` becomes derived from `lead_matches` where status='accepted'

**Build:**
1. New cron-style endpoint `api/process-lead-cascade.js` that runs every minute:
   - Find leads with `status='New'` and `delivered_at` older than the current tier's window
   - If no contractor accepted, escalate to next tier (write new `lead_matches` rows, fire new GHL notify webhook)
   - If max tier exhausted (Basic), mark lead `status='Unmatched'`
2. Schedule via Vercel Cron (1-min interval) or Supabase pg_cron
3. Update `create-lead.js` matcher to write `lead_matches` rows for the **first tier only** initially
4. Update accept-lead path (in `lead-response.js` and contractor-dashboard.html) to:
   - Set `status='accepted'` on the matching `lead_matches` row
   - Update parent `leads` row status to `Accepted`, set `assigned_contractor_id`
   - Mark sibling matches as `superseded`

**Verify:** Send a test lead to a region with all three tiers. Don't accept on Elite. Confirm Pro gets notified after Elite's window expires. Don't accept on Pro. Confirm Basic gets notified.

### 1.4 Schema cleanup *(1 day)*

From `docs/V2-SCHEMA.md` "Known landmines":

- **Add storage DELETE policy** on `contractor-docs` bucket so "Remove" actually deletes files
- **Drop dead columns** on contractors: `lead_count`, `acceptance_rate`, `avg_response_time`, `total_lead_charges` (or wire them via triggers — owner picks)
- **Decide on `leads.budget`, `property_type`, `preferred_contact`** — either remove the dead reads in dashboard, or build the intake fields
- **Verify unique index on `LOWER(contractors.email)`** exists. If not, add it. Two writers race on this.
- **Document RLS policies** in `docs/V2-SCHEMA.md` and verify each table has the policies the code assumes

### 1.5 Audit duplicate GHL workflows *(1 hr in GHL UI)*

Two workflows fire `homeowner_matched`:
- `c8b7ef11-035b-4266-9334-6043c1424208` (from `create-lead.js`)
- `cSb176GBaN3hMu0573QO` (from contractor-dashboard.html on accept)

One is canonical, one is a leftover. Audit in GHL, consolidate, update code to fire only the right one.

### 1.6 Remove hard-coded admin password *(2 hr)*

`ssp2025` is hard-coded in `admin-data.js`, `admin-config.js`, `save-pricing.js`. Migrate all to `ADMIN_PASSWORD` env var with the same fallback as `admin-update-contractor.js`.

**Phase 1 Definition of Done:**
- Contractors can self-serve all subscription management
- AI-powered intake live
- Cascading dispatch actually works
- Schema is documented, dead columns resolved, RLS verified
- Admin password not in code

---

## Phase 2 — New features (Months 2–4)

Now we build what v1 doesn't have. These are real net-new features that grow revenue or unlock new use cases.

### 2.1 Reviews & ratings system

**Why:** Marketplace credibility layer. Without reviews, every contractor is identical to homeowners. With reviews, contractors with reputations can't easily leave (lock-in).

**Schema additions (see V2-SCHEMA.md):**
- New `reviews` table

**Build:**
- Auto-trigger review request after job completion (SMS + email to homeowner via GHL workflow)
- Public-facing contractor profile pages with reviews and average rating
- Review moderation queue in admin dashboard
- Star rating impacts matching priority in cascade engine
- Auto-flag contractors with 3+ <3-star reviews in 30 days
- Disputed reviews go to admin queue

### 2.2 In-app messaging

**Why:** Communication record between homeowner and contractor (dispute resolution evidence). Also keeps the relationship inside SSP rather than going off-platform after first contact.

**Schema:** new `messages` table.

**Build:**
- Messaging panel in contractor dashboard (lead-scoped)
- Messaging page for homeowner (link in confirmation email + on tracking page)
- SMS bridging: contractor's reply via SMS posts to thread (Twilio inbound)
- Real-time updates via Supabase Realtime

### 2.3 Real-time notifications (web push)

Currently contractors have to keep dashboard open or rely on email. Push notification when a lead arrives.

**Build:**
- Browser permission flow on dashboard load
- FCM Web Push for desktop browsers
- Server-side fan-out from `lead_matches` insert
- Notification settings UI (already exists — wire it up)

### 2.4 Calendar / availability

**Why:** Don't route leads to contractors who are on vacation or fully booked.

**Schema:** new `availability_blocks` table.

**Build:**
- Calendar view in contractor dashboard
- Block out dates/hours
- Optional Google Calendar sync (one-way: pull busy times)
- Cascade engine respects availability when matching

### 2.5 Stripe Connect for job-level payments *(biggest revenue unlock)*

**Why:** Currently SSP monetizes via subscriptions + per-lead fees. Adding job-level transactions unlocks **3% transaction fee on every job processed through SSP**. Even at 100 jobs/mo × $500 avg, that's $1,500/mo new revenue at near-zero marginal cost.

**Schema:** new `transactions`, `jobs`, `estimates` tables.

**Build:**
1. Stripe Connect Express onboarding flow for contractors (in dashboard)
2. Estimate workflow: contractor creates estimate inside SSP → homeowner approves
3. Payment collection: homeowner pays via SSP → SSP keeps 3% → Stripe Connect transfers to contractor
4. Job completion + photo upload (proof of work)
5. Dispute flow tied to messaging

This is a big chunk of work — break into sub-phases when scoping.

### 2.6 Audit log

`audit_log` table that captures every meaningful action: contractor status changes, price changes, manual lead overrides, etc. Surface in admin dashboard.

---

## Phase 3 — Tech debt & growth (Month 4+)

These are not blockers but improve velocity.

### 3.1 Migrate to Next.js

**Trigger:** when adding new pages becomes painful, or when SEO requirements outgrow static HTML.

**Approach:** Don't rewrite all at once. Set up Next.js as the default routing layer, add new pages as Next.js components, migrate existing pages one at a time as they need updates.

**Stack:** Next.js 15 + TypeScript + shadcn/ui + Tailwind. Keep Vercel hosting.

### 3.2 Type safety end-to-end

Generate Supabase TypeScript types. Migrate `api/*.js` to `api/*.ts`. Adds confidence in refactors.

### 3.3 Test coverage

No tests exist today. Add at least:
- Unit tests for `create-lead.js` matcher logic
- Integration test for Stripe webhook handler
- E2E test (Playwright) for signup flow

### 3.4 Monitoring

Add Sentry for error tracking. Vercel Analytics for traffic. Supabase Dashboard for query perf.

### 3.5 Other potential features (priority-tbd)

- Spanish language support (Houston demographic relevance)
- Native mobile app (PWA first, native later)
- Contractor referral program (credits for referring other contractors)
- Homeowner referral program
- Gift cards / promo codes
- Live license verification automation (TDLR API real-time vs current flow)

---

## Cost & timeline

With Claude Code as the primary build tool:
- **Phase 0:** 1–2 days
- **Phase 1:** 2–3 weeks
- **Phase 2:** 2–3 months
- **Phase 3:** ongoing as needed

**Recurring tooling costs:**
- Vercel Pro: $20/mo (already paid)
- Supabase Pro: $25/mo (when scaling past free tier)
- Stripe: ~2.9% + $0.30 per transaction
- SendGrid (transactional email): $20–80/mo
- Twilio (SMS, post-A2P): $10–50/mo + per-message
- Anthropic Claude API: ~$20–100/mo depending on intake volume

**Total recurring cost at modest scale:** ~$100–300/mo plus payment processing.

---

## Decision log

This section tracks notable decisions and the reasoning, so future sessions don't relitigate them.

- **2026-04: Keep static HTML for now, migrate later.** Reason: framework migration is multi-week and doesn't unlock revenue. Phase 0 fixes do.
- **2026-04: Wire AI intake (don't remove).** Reason: differentiator the owner has been excited about for months. Worth the wiring time.
- **2026-04: Customer Portal over building plan-change UI.** Reason: 30 min config + 1 hr code vs weeks to build equivalent UI. Stripe handles the edge cases.
- **2026-04: Reviews before transaction layer.** Reason: reviews unlock matching priority and lock-in; transactions are bigger work; reviews are foundation.

---

## Appendix: How to use this doc

- **Before starting any task,** open this doc and find the matching item. Read the linked context.
- **Phase numbers are priorities.** Don't work on Phase 2 items while Phase 0 items remain.
- **If something here is wrong,** flag it. The doc is meant to be updated as ground truth shifts. Add an entry to the decision log when you change something.
