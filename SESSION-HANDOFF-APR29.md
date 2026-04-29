# SSP V2 — Handoff for next chat session

**Date:** April 29, 2026 (end of session)
**Last commit:** `f4510d1` on main — "Phase 0.4: fix Stripe customer race condition"

---

## Where we are

David is building **SSP v2** using **Claude Code** (installed and authenticated on his Windows work computer). Three planning docs are committed to the repo and serve as the foundation:

- `CLAUDE.md` (repo root) — Claude Code reads this every session
- `docs/V2-PLAN.md` — phased build plan (Phase 0 → 1 → 2 → 3)
- `docs/V2-SCHEMA.md` — current Supabase schema + v2 target schema

These docs are the source of truth. **Read them before doing anything else.**

---

## Setup status (don't redo)

- ✅ Claude Code installed: `C:\Users\Davidm\.local\bin\claude.exe`, version 2.1.123
- ✅ Git installed: 2.53.0.windows.2
- ✅ VS Code installed and configured
- ✅ Repo cloned: `C:\Users\Davidm\selectservicepros-pages` (this is the real working repo)
- ⚠️ A second copy exists at `C:\Users\Davidm\OneDrive - Select Home Warranty\Select service pros\` — **NOT a git repo, do NOT use this folder**. It's a stale local copy from before the GitHub setup.
- ⚠️ Git author identity is auto-derived from Windows hostname (`David M <DavidM@SHW.local>`). David should run once to fix:
  ```
  git config --global user.email "dave@selecthomewarranty.com"
  git config --global user.name "David Moradi"
  ```

---

## Phase 0 progress

| # | Task | Status |
|---|---|---|
| 0.1 | Fix malformed GHL webhook URL in `api/create-lead.js` | ✅ Done, committed `dbbab7b`, pushed |
| 0.5 | Delete dead duplicate root files | ✅ Done — `stripe-webhook.js`, `zip-lookup.js`, `api/ssp-config.js` deleted |
| 0.5 | `lead-response.html` (root) | ⏸️ HELD — needs David to check GHL email templates first to confirm no inbound links |
| 0.6 | Delete BD dead code | ✅ Done — `api/bd-login.js`, `api/create-bd-account.js` deleted |
| 0.7 | Delete orphaned FAQ pages | ✅ Done — `faq-homeowners.html`, `faq-contractors.html` deleted |
| 0.4 | Fix Stripe customer race condition in `api/create-checkout-session.js` | ✅ Done, committed `f4510d1`, pushed |
| 0.4 | **Test the fix end-to-end** | ⏳ NOT YET TESTED — see test plan below |
| 0.2 | Standardize `platform_config.pricing` shape | ⏳ Not started — code-only, ~1 hour |
| 0.3 | Wire up Stripe Customer Portal | ⏳ Not started — needs Stripe Dashboard config first, ~1.5 hours |

---

## Live Supabase findings (from queries David ran in SQL editor)

These were findings that **changed the V2 plan**:

### Finding 1: Email uniqueness ✅
- Index `contractors_email_key` exists (UNIQUE on `email`, case-sensitive — not `LOWER(email)` as documented)
- Functionally fine for now. Theoretical edge case: `Dave@Example.com` and `dave@example.com` would be treated as different rows. Should verify code lowercases on insert.
- Also: redundant non-unique indexes exist on `email`, `auth_id`, `status` — harmless storage waste, cleanup task for later.

### Finding 2: Pricing config is canonical ✅
Current value in `platform_config` where `key='pricing'`:
```json
{
  "Pro":   {"monthly": 99,  "perLead": 29, "responseWindow": 45},
  "Basic": {"monthly": 49,  "perLead": 39, "responseWindow": 30},
  "Elite": {"monthly": 199, "perLead": 19, "responseWindow": 60}
}
```
**This is the canonical PascalCase shape that `create-lead.js` reads.** Leads are getting correct `lead_fee` values today. Phase 0.2 simplifies to: just make `save-pricing.js` and `admin-dashboard.html` write/read this shape so nothing drifts. No data migration needed.

### Finding 3: RLS policies have redundant pairs ⚠️
Policies on `contractors`, `contractor_licenses`, `leads`, and `storage.objects` have BOTH granular per-action policies (SELECT/UPDATE/INSERT separate) AND duplicate "ALL" bulk policies (`own contractor row`, `own licenses`, `own leads`, `contractor own files`). Multiple policies on same table = OR logic, so duplicates aren't a security issue, but unclear intent. Cleanup task for Phase 1.4. **Notable:** `contractor own files` ALL policy on storage already grants DELETE — Phase 1.4 should test if files actually get deleted on Remove click before adding a separate DELETE policy.

**These three findings need to be reflected in `docs/V2-SCHEMA.md` and `docs/V2-PLAN.md`.** Claude Code was about to do this update but session ended before it happened. Next session should update those docs to match reality.

---

## Critical pending action: TEST 0.4 BEFORE TRUSTING IT

The Stripe customer race condition fix is committed and pushed but **not yet tested in production**. Race fixes are exactly the kind of thing that look right in the diff but break silently. Test scenario:

1. Wait for Vercel to deploy commit `f4510d1` (should already be live by next session)
2. Go to https://www.selectservicepros.com/contractor-signup.html
3. Sign up as **Pro** with throwaway email like `test-race-apr29@example.com`
4. Get to Stripe Checkout iframe — DO NOT pay, close the tab
5. Reopen signup, use **same email**, pick **Elite**, complete payment with `4242 4242 4242 4242`
6. Check Stripe Dashboard (test mode) → Customers → search email
7. **Expected: ONE customer with one Elite subscription. NOT two customers.**
8. Also check Supabase `contractors` table — should be ONE row, Elite tier, valid `stripe_customer_id`

If TWO customers exist after this test → race fix didn't engage. Debug.

---

## Other unresolved items

1. **`lead-response.html` (root)** — David needs to log into GHL and check the email templates that send "Accept lead" / "Pass on lead" buttons to contractors. If the buttons link to `lead-response.html?action=...` → file is in use, don't delete. If they link to `/api/lead-response?action=...` → safe to delete.

2. **Stale OneDrive copy** — eventually rename `C:\Users\Davidm\OneDrive - Select Home Warranty\Select service pros\` to something like `OLD-SSP-DO-NOT-EDIT` so David doesn't accidentally edit there. Not urgent.

3. **Three doc updates pending** — Reflect the live Supabase findings (above) in `docs/V2-SCHEMA.md` and `docs/V2-PLAN.md`.

---

## What to do next session, in priority order

### Step 1 — Quick context check (5 min)
- Read `CLAUDE.md`, `docs/V2-PLAN.md`, `docs/V2-SCHEMA.md`
- Confirm everything is still where it should be

### Step 2 — Test 0.4 (10 min)
Run the test scenario above. Tell David the result.

### Step 3 — Update docs with live Supabase findings (15 min)
The three findings above need to land in `docs/V2-SCHEMA.md` and `docs/V2-PLAN.md`. Small commit, separate from feature work.

### Step 4 — Choose Phase 0's last items (David's call)
- **0.2 (pricing standardization)** — pure code, ~1 hour. Recommended next.
- **0.3 (Stripe Customer Portal)** — biggest UX win, ~1.5 hours, needs Stripe Dashboard config first
- **`lead-response.html` decision** — needs David to check GHL templates, then 5-min delete

### Step 5 — Phase 1 (when Phase 0 wraps)
Per V2-PLAN, in order:
- 1.1 Real Billing tab in contractor dashboard (1-2 days, biggest visible "this looks done" win)
- 1.2 Wire `next-question.js` to `intake-v2.html` (1 day, AI intake feature)
- 1.3 Cascading dispatch (2-3 days, requires `lead_matches` schema migration)
- 1.4 Schema cleanup (1 day)
- 1.5 Audit duplicate GHL workflows (1 hr in GHL UI)
- 1.6 Remove hard-coded admin password (2 hrs)

---

## Strategic context (for future sessions)

- **David has people running the SHW Premium Contractor Program.** SSP v2 work has bandwidth now. Don't keep deflecting v2 questions with "let's wait."
- **David is non-developer, voice-memo communicator.** Push back when about to break things. Don't over-explain.
- **Don't bundle multiple changes per commit.** Each commit should be reviewable in isolation.
- **David reviews diff before push.** Show diff. Wait for approval. Don't auto-push.
- **Use Claude Code, not chat-and-paste.** Claude Code can read files, edit them, commit. Chat is for strategy / review / sanity checks.
- **The "contractor dashboard rebuild" question came up at end of session and was correctly pushed back on.** The dashboard exists (178KB, 3,226 lines, 7 tabs, working). What's actually unfinished is the Billing tab (Phase 1.1), not the whole dashboard. If David asks again next session — same answer.

---

## How David should start the next chat session

Open a new chat in Claude (here, with the SSP project). First message:

```
New session. Read SESSION-HANDOFF-APR29.md from project files (or the
attached doc) for current state. Then test 0.4 first per the test plan.
After that we'll decide next move.
```

Then in VS Code, in the `selectservicepros-pages` folder, open a terminal:
```
cd C:\Users\Davidm\selectservicepros-pages
git pull
claude
```

In Claude Code, first message:
```
Read CLAUDE.md, docs/V2-PLAN.md, docs/V2-SCHEMA.md, and SESSION-HANDOFF-APR29.md.
Confirm you have full context. Don't write code yet.
```

Then follow the priority list above.

---

## Files in this repo as of session end

```
selectservicepros-pages/
├── CLAUDE.md                          [NEW this session]
├── SSP-BRAND-BIBLE.md
├── api/
│   ├── admin-config.js
│   ├── admin-data.js
│   ├── admin-update-contractor.js
│   ├── create-checkout-session.js     [MODIFIED - 0.4 fix]
│   ├── create-contractor.js
│   ├── create-lead.js                 [MODIFIED - 0.1 fix]
│   ├── lead-response.js
│   ├── next-question.js
│   ├── save-pricing.js
│   ├── stripe-webhook.js
│   ├── verify-license.js
│   └── zip-lookup.js
├── docs/
│   ├── V2-PLAN.md                     [NEW this session]
│   └── V2-SCHEMA.md                   [NEW this session]
├── admin-dashboard.html
├── admin.html
├── contractor-dashboard.html          (178KB, 7 tabs - WORKING)
├── contractor-login.html
├── contractor-signup.html
├── index.html
├── intake-v2.html
├── lead-response.html                 (HELD - check GHL templates)
├── package.json
├── reset-password.html
└── ssp-config.js

[DELETED this session]:
- stripe-webhook.js (root)
- zip-lookup.js (root)
- api/ssp-config.js
- api/bd-login.js
- api/create-bd-account.js
- faq-homeowners.html
- faq-contractors.html
```

---

## Decisions made this session (do not relitigate)

1. SSP v2 build is GO. David's bandwidth is freed by SHW delegation.
2. Use Claude Code as primary build tool, chat for strategy.
3. Static HTML stays for now; Next.js migration is Phase 3.
4. Wire up AI intake (don't remove `next-question.js`).
5. Use Stripe Customer Portal vs. building plan-change UI.
6. Keep `C:\Users\Davidm\selectservicepros-pages\` as the real working repo. OneDrive folder is dead.
7. Don't whitelist `git *` in Claude Code — too broad. One-time approvals only for now.
