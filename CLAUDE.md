# CLAUDE.md — Select Service Pros (SSP) project briefing

You are working on **Select Service Pros (SSP)**, a lead-generation marketplace for home-service contractors in Houston, TX. This file is your standing context. Read it at the start of every session before doing any work.

---

## 1. What this project is

SSP connects homeowners with licensed home-service contractors (HVAC, plumbing, electrical, etc.). Homeowners describe a job; matched contractors who pay a monthly subscription get notified, can accept (incurring a per-lead fee) or pass.

**Sister business:** Select Home Warranty (SHW). SSP's owner runs both. SHW is a separate codebase and not part of this repo.

**Business model:**
- 3 tiers: **Basic** $49/mo + $39/lead (30-min response window), **Pro** $99/mo + $29/lead (45-min), **Elite** $199/mo + $19/lead (60-min, exclusive first access).
- Tiered routing: Elite gets a lead first; if they don't claim, it cascades to Pro, then Basic. **Note:** the cascade isn't actually built in code yet — only one contractor is matched per lead today. Fixing this is a v2 priority. See `docs/V2-PLAN.md`.
- Up to ~3 contractors notified per job (target — not enforced today).
- Service area: Houston metro initially, expanding by ZIP cohorts.

**Pricing source of truth:** `SSP-BRAND-BIBLE.md` is canonical. Always defer to it.

---

## 2. Tech stack

**This is a static-HTML + Vercel-serverless app — no framework on the frontend yet.** v2 plans to migrate to Next.js. Until then, do not introduce React/Next/build steps unless explicitly told to.

| Layer | Tech |
|---|---|
| Frontend | Hand-written HTML/CSS/JS, one file per page. DM Sans + Fraunces fonts. |
| Hosting | Vercel (auto-deploys from GitHub `main`) |
| API | Vercel serverless functions in `/api/*.js` (Node + a couple of edge runtimes) |
| Database | Supabase Postgres |
| Auth | Supabase Auth (email/password, recovery links) — JWT in browser |
| File storage | Supabase Storage bucket `contractor-docs` (RLS-scoped) |
| Payments | Stripe Checkout (embedded mode), subscriptions; webhook drives provisioning |
| CRM / email / SMS | GoHighLevel (GHL) — webhooks fire workflows |
| AI intake | Anthropic Claude (`claude-sonnet-4-20250514`) for adaptive intake — **endpoint exists, not wired up to frontend yet** |
| License verify | TDLR (Socrata) for HVAC/Electrical, TSBPE CSVs for Plumbing |
| Address | Google Places Autocomplete, zip-codes.com radius API, BigDataCloud reverse-geocode |

**External system IDs (do not change):**
- Supabase URL: `https://kasqtxwbsmjlisbnebku.supabase.co`
- GHL sub-account: `QfDToN545k1TOpFZa5AQ`
- GitHub repo: `Davemoradi/selectservicepros-pages`

---

## 3. File structure

### Root files

| File | Purpose | Status |
|---|---|---|
| `index.html` | Homeowner homepage with hero search, category tiles, deep-links into intake-v2 | Live |
| `intake-v2.html` | 4-step homeowner lead intake funnel with partial-save at Step 2 | Live |
| `contractor-signup.html` | 2-step contractor signup → Stripe embedded checkout | Live |
| `contractor-login.html` | Email/password sign-in via Supabase JS SDK | Live |
| `contractor-dashboard.html` | Multi-tab SPA contractor portal (178 KB / 3,226 lines, 7 tabs) | Mostly live, Billing tab is mock |
| `reset-password.html` | Handles Supabase recovery flows | Live |
| `admin.html` | Admin Platform Configuration panel (categories + markets) | Live |
| `admin-dashboard.html` | Admin business overview (contractors, leads, MRR, pricing editor) | Live |
| `lead-response.html` | **ORPHANED** — legacy email-target page, superseded by `/api/lead-response` | Delete in Phase 0 |
| `faq-homeowners.html` / `faq-contractors.html` | FAQ pages | **ORPHANED** — not linked from nav |
| `ssp-config.js` | Public client-side config (plan list, markets, GHL webhook URL) | Live, current pricing |
| `stripe-webhook.js` | **DEAD** — older copy of `api/stripe-webhook.js` at root | Delete in Phase 0 |
| `zip-lookup.js` | **DEAD** — older copy at root | Delete in Phase 0 |
| `package.json` | Just `stripe` + `@supabase/supabase-js` | — |
| `SSP-BRAND-BIBLE.md` | Brand/design/pricing source of truth — always defer to this | — |
| `logo-email.png` | Asset for transactional emails | — |

### `/api/` folder (Vercel serverless functions)

| File | Purpose |
|---|---|
| `create-lead.js` | Lead intake. Three branches: partial save (Step 2), final-with-leadId (Step 4 normal), final-no-leadId (legacy). Runs matcher, fires GHL webhooks. **Has a malformed webhook URL bug — see `docs/V2-PLAN.md` Phase 0.** |
| `create-contractor.js` | Post-Stripe-payment provisioning. Creates Supabase auth user, generates recovery link, upserts contractors row, fires WF5 welcome email. |
| `create-checkout-session.js` | Builds Stripe Checkout Session in embedded + subscription mode. Hard-coded prices in cents. **Has Stripe customer race condition — see `docs/V2-PLAN.md` Phase 0.** |
| `stripe-webhook.js` | Verifies Stripe signature, idempotency-checks via `stripe_events`, handles `checkout.session.completed` and `customer.subscription.deleted`. |
| `lead-response.js` | Handles `?action=accept|pass&leadId&contractorId` URLs from emails. Writes to Supabase, fires GHL. |
| `next-question.js` | **NOT WIRED UP.** Edge runtime. Calls Anthropic Claude for adaptive intake questions. `intake-v2.html` doesn't call it — uses hard-coded pills. Decide in Phase 1: wire up or remove. |
| `admin-data.js` | Returns contractors + recent leads, computes per-contractor stats, MRR. Password-gated (`ssp2025`). |
| `admin-config.js` | Read/write `platform_config` rows. Password-gated. |
| `admin-update-contractor.js` | Status mutation (Active/Suspended/etc). Password-gated, supports `ADMIN_PASSWORD` env override. |
| `save-pricing.js` | Reads/writes pricing in `platform_config`. **Has pricing-key-shape mismatch with create-lead.js — see `docs/V2-PLAN.md` Phase 0.** |
| `verify-license.js` | TDLR/TSBPE license verification. |
| `zip-lookup.js` | Wraps zip-codes.com `FindZipCodesInRadius`. |
| `bd-login.js` / `create-bd-account.js` | **DEAD.** Brilliant Directories proxy — BD has been replaced. Delete in Phase 0. |
| `ssp-config.js` | **OUT OF DATE.** Has old pricing ($99/$199/$299). Either sync to root version or delete. |

---

## 4. Database schema

Full schema reference: `docs/V2-SCHEMA.md`. Quick summary:

**Tables in active use:**
- `contractors` — primary table for paying members. Has status state machine.
- `leads` — homeowner job requests with partial-save support.
- `contractor_licenses` — per-trade licenses (HVAC/Plumbing/Electrical).
- `platform_config` — key/value config (pricing, service_categories, markets).
- `stripe_events` — webhook idempotency + audit trail.
- `auth.users` — Supabase managed.
- Storage bucket: `contractor-docs`.

**Status state machine for `contractors.status`:**
`Pending Profile` → `Pending Verification` (after Stripe) → `Pending Review` (after agreement signed) → `Active` (after admin approval) → `Suspended` / `Deletion Requested` / `Deleted`.
Lead routing only fires for `Active` contractors.

**Known schema landmines (see V2-SCHEMA.md for fixes):**
- Two contractors writers race (signup API + Stripe webhook) — relies on unique email index. Verify it exists.
- `leads.budget`, `property_type`, `preferred_contact` are read but never written.
- `contractors.lead_count`, `acceptance_rate`, `avg_response_time`, `total_lead_charges` are dead columns — never updated, admin recomputes from `leads`.
- No DELETE policy on `contractor-docs` storage bucket — files orphan when "Remove" is clicked.

---

## 5. Conventions

### Code style
- **HTML:** one file per page, no shared layouts/includes. Inline `<style>` blocks are fine. DM Sans for body, Fraunces for display.
- **CSS variables:** always use the design tokens defined in `SSP-BRAND-BIBLE.md`. Never hard-code colors.
- **JavaScript:** vanilla, no framework. Use `const`/`let` not `var`. ES modules only inside `/api/`.
- **API routes:** named after the resource action (`create-lead.js`, `update-contractor.js`). Handlers are default exports.
- **Errors:** server returns JSON `{error: "message"}` with appropriate HTTP code. Frontend shows toast.
- **Webhooks:** always wrap GHL/Stripe webhook calls in try/catch with non-fatal logging. Lead/contractor creation must not fail because a webhook failed.
- **Date format:** ISO 8601 in DB, human-readable in UI.

### Git & deploys
- `main` auto-deploys to production via Vercel.
- **No PR review process exists yet.** Be careful with `main` pushes.
- Test on Vercel preview branches when changes are risky.

### Environment variables (Vercel)
- `SUPABASE_SERVICE_ROLE_KEY` — required for server-side writes
- `SUPABASE_ANON_KEY` — public, embedded in HTML
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `ANTHROPIC_API_KEY` — for `next-question.js`
- `ZIPCODE_API_KEY` — for zip-codes.com
- `ADMIN_PASSWORD` — overrides hard-coded `ssp2025` in some endpoints (not all)

---

## 6. Common commands

```powershell
# Run locally with Vercel CLI (requires `npm i -g vercel`)
vercel dev

# Deploy preview
vercel

# Deploy production (or just push to main)
vercel --prod

# View Vercel logs
vercel logs <deployment-url>
```

For Supabase queries, use the Supabase SQL editor in the dashboard. Programmatic access is via the JS SDK with `SUPABASE_SERVICE_ROLE_KEY` (server) or `SUPABASE_ANON_KEY` (browser).

---

## 7. Do not modify without explicit instruction

- `SSP-BRAND-BIBLE.md` (source of truth — only update with owner approval)
- `api/stripe-webhook.js` (production payment flow — extra care, test thoroughly)
- `api/create-contractor.js` (provisioning chain — race-sensitive)
- Anything that touches `platform_config.pricing` shape (until Phase 0 standardization is done)
- Stripe webhook signature verification logic
- Supabase RLS policies (changes require schema migration discipline — see V2-SCHEMA.md)

---

## 8. Working with the SSP owner

- **Owner is non-developer.** Communicate in plain language. Never assume technical knowledge.
- **Voice-memo style.** Owner gives terse, direct instructions. Don't over-clarify; interpret intent and execute. Push back only when about to break something.
- **Verify with data.** Before claiming something works, test it. Read the deployed file. Run the query. Don't guess.
- **One thing at a time.** Don't bundle multiple changes into one task without permission. Each change should be reviewable.
- **Show the diff before committing.** Always.
- **Owner reviews and pushes to GitHub manually for now.** Don't auto-push without explicit confirmation.

---

## 9. SSP brand spec (logo, colors)

**Logo:** Orange circle with white checkmark inside, followed by **"Select"** in white, **"Service"** in orange, **"Pros"** in white. One word, no spaces, no icon separation. Common mistake: misordering the colors. Always verify against `SSP-BRAND-BIBLE.md`.

**Colors (canonical):**
- Orange: `#f05528`
- Navy: `#0a1628`
- Gradient (CTA): `135deg, #f05528 → #d94a20`

**Layout patterns:**
- Hero / top sections: white background
- "How It Works" section: navy background, white text
- Footer: navy background, white/muted text, orange hover on links
- CTA banner: orange gradient, white text

---

## 10. Where to look first when starting a task

1. **`SSP-BRAND-BIBLE.md`** for design/pricing/copy decisions
2. **`docs/V2-PLAN.md`** for what's prioritized and why
3. **`docs/V2-SCHEMA.md`** for database structure
4. **This file** for tech stack and conventions

If you're about to do something that contradicts any of these four documents, stop and confirm with the owner first.
