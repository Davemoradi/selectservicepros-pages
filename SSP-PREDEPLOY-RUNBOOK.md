# SSP Pre-Deploy Runbook

**Status: LIVE DATABASE PHASE B PARTIALLY APPLIED — APPLICATION CODE NOT YET DEPLOYED.**

As of 2026-09-23, the Select Service Pros production Supabase project has the v1 pricing seed, wallet top-up guardrails, durable API rate-limit structures, Founding 25 RPCs, dispute-decision RPC, notification outbox/triggers, compatibility columns, verification-reset triggers, and interim privileged-field guards applied. Cron remains OFF and GHL remains untouched. The GitHub/Vercel application cutover is still pending because the connected GitHub integration is read-only for refs and the connected Vercel account does not expose the SSP project.

The order matters in one specific way: **hardening privileges before fixing the dashboard breaks onboarding, and fixing the dashboard before hardening leaves the hole open.** Deploy code first, then harden, then test both directions.

---

## 0. Before you start

You need: Supabase SQL editor access, Vercel env var access, GitHub write access, and a throwaway contractor account with a known password.

Do **not** run any of this against production while a real contractor is mid-signup.

---

## 1. Environment variables (Vercel → Settings → Environment Variables)

| Name | Value | Used by |
|---|---|---|
| `SUPABASE_ANON_KEY` | project anon key | `lead-accept.js` |
| `GHL_SSP_EVENTS_WEBHOOK` | the single events webhook | worker only |
| `NOTIFICATION_WORKER_SECRET` | `openssl rand -hex 32` | worker auth |
| `LEAD_PARTIAL_SECRET` | `openssl rand -hex 32` | signs partial-lead finalization tokens in `create-lead.js` |
| `RATE_LIMIT_SECRET` | `openssl rand -hex 32` | HMACs signup/intake rate-limit keys before DB storage |
| `STRIPE_SECRET_KEY` | Stripe secret key | creates one-time wallet funding checkout sessions |
| `STRIPE_WEBHOOK_SECRET` | Stripe endpoint signing secret | verifies `/api/stripe-webhook` |
| `SSP_SITE_URL` | `https://www.selectservicepros.com` | optional explicit Stripe success/cancel base URL |
| `SSP_ADMIN_EMAILS` | comma-separated authorized admin emails | server-side admin allowlist; alternatively user `app_metadata.role=admin` |

**Delete** `GHL_HOMEOWNER_MATCHED` and `GHL_REVIEW_WEBHOOK` if present. Leaving them does nothing — no code reads them — but they will mislead whoever reads the config next.

**Redeploy after setting.** Env changes do not take effect until you do. Set them *before* uploading the files, or the first accept returns `server_misconfigured`.

`LEAD_PARTIAL_SECRET` is also required before the new intake goes live. It authorizes a browser to finalize only the specific Partial row the server just created; a bare lead UUID is no longer sufficient to overwrite a Partial lead.

`RATE_LIMIT_SECRET` is required by both public creation endpoints. The new limiter fails closed if the shared Postgres counter is unavailable; do not deploy those endpoints before migration 05 exists. Stripe variables are required only when self-service wallet funding is enabled.

---

## 2. Audit first — read, do not change

Run **Part 0** of `20260916_01_contractor_schema_security.sql`.

Three things to read out of the output:

1. **Does `authenticated` hold table-wide UPDATE on `contractors`?** If yes, the self-funding hole is live right now: RLS passes on `auth_id = auth.uid()`, and the contractor can PATCH `lead_balance_cents` through the REST API with no dashboard involved.
2. **Which allowlisted columns do not exist?** The migration raises a warning for each. Any missing column means the dashboard writes something the grant loop will skip, and that save will fail after hardening.
3. **Is `contractor-docs` public?** If yes, every insurance certificate and licence uploaded so far is readable by anyone with the URL.

Live audit completed 2026-09-23. Findings: `services_detail` and `business_hours` are `jsonb`; `payment_methods` is `text[]` and is intentionally preserved; `contractor-docs` is private; the historical all-row contractor SELECT policy was incorrectly scoped to `public` and has been corrected to `service_role`; authenticated broad UPDATE still exists temporarily for legacy-dashboard compatibility, with interim database guards blocking wallet/self-activation/verification escalation until the new dashboard is deployed.

---

## 2a. Live database work completed 2026-09-23

Applied successfully to project `kasqtxwbsmjlisbnebku`:

- compatibility + immediate policy/storage-cap hardening (`20260923_08_phase_b_compatibility_and_immediate_security.sql`)
- v1 pricing seed: 106 rows / 99 priced / 7 HeldForReview
- canonical idempotent `credit_wallet` top-up guardrails
- durable API rate-limit table/RPC
- Founding 25 activation and one-time $250 promo RPCs
- exact dispute decision/reversal RPC
- notification outbox, claim/settle RPCs and DB event triggers
- non-breaking privilege cleanup/search_path hardening (`20260923_09...`)
- interim privileged-field triggers (`20260923_10...`)

Transactional rollback tests passed for: 3-slot offer creation, pre-accept PII exclusion, accept/debit, decline/refill, post-accept PII event, Founding 25 idempotency, and exact dispute reversal. Cron count remains 0.

**Do not run the full historical migration 01 blindly through the current Supabase management connection.** `storage.objects` is owned by `supabase_storage_admin`; an attempted `ALTER TABLE storage.objects` failed atomically with `must be owner of table objects`. Storage RLS is already enabled. Policy cleanup on `storage.objects` must use an owner-capable path or be handled separately.

## 2b. Deployment order — do not create a broken window

The new `contractor-workflow.js` writes `agreement_accepted_user_agent`, a
column migration 01 creates. Deploying the code first means every agreement
submission fails on an unknown column until the migration lands.

Additive schema comes first; privilege revocation comes last:

| Phase | What | Why here |
|---|---|---|
| **A** | Audit (Part 0 of migration 01) | Read before changing |
| **B** | Additive schema, storage, outbox, pricing, wallet guardrails and rate-limit structures | New code references columns/RPCs that must already exist |
| **C** | Deploy application code | Compatible with both old and new grants |
| **D** | Verify normal operations | Onboarding still works |
| **E** | Privilege revocation + triggers | The hardening itself |
| **F** | Hostile REST tests | Prove the holes are closed |
| **G** | M8b | Later, separately |

Phase B is safe on its own: every statement is `add column if not exists`,
`create table if not exists`, or a policy recreate. Nothing is dropped.

## 3. Deploy code (phase C — NEXT)

Upload to GitHub → Vercel auto-deploys:

```
index.html
contractor-dashboard.html
contractor-signup.html
intake-v2.html
api/create-lead.js
api/lead-accept.js
api/lead-decline.js
api/contractor-workflow.js          (new)
api/process-notifications.js        (new)
api/create-contractor.js
api/create-checkout-session.js       (rewritten: one-time wallet funding)
api/stripe-webhook.js                (rewritten: verified wallet credit only)
scripts/verify-ssp-hardening.js     (new)
supabase/migrations/20260916_01_contractor_schema_security.sql   (new)
supabase/migrations/20260916_02_notification_outbox.sql          (new)
supabase/migrations/20260917_03_pricing_taxonomy_v1.sql          (new)
supabase/migrations/20260923_04_wallet_topup_guardrails.sql      (new)
supabase/migrations/20260923_05_api_rate_limits.sql              (new)
ssp-taxonomy-v1.js                  (new)
SSP-PRICING-TAXONOMY-v1.md          (new)
SSP-GHL-EVENT-CONTRACT.md           (new)
SSP-PREDEPLOY-RUNBOOK.md            (new)
```

Code first, deliberately: the new dashboard no longer writes any privileged column, so it keeps working both before and after hardening. The old one would break the moment you harden.

**Verify the deploy landed** — raw GitHub will lie to you for a minute:

```bash
curl -s "https://raw.githubusercontent.com/Davemoradi/selectservicepros-pages/main/contractor-dashboard.html?_=$(date +%s)" \
  | grep -c "get_my_offers"        # expect 2
```

---

## 4. Smoke-test the auth boundary

`create-lead.js` is now statically refactored to snapshot `band_map` v1 pricing, finalize signed partial submissions, and delegate matching to `fill_offer_slots`. The canonical v1 taxonomy is in `ssp-taxonomy-v1.js` and its seed migration is `supabase/migrations/20260917_03_pricing_taxonomy_v1.sql`. Do not send real traffic through it until that seed is applied and verified against the live schema and the live schema/privilege tests below pass. You can still prove the accept/decline auth boundary independently:

```bash
# no token -> 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://www.selectservicepros.com/api/lead-accept \
  -H "Content-Type: application/json" -d '{"lead_id":"00000000-0000-4000-8000-000000000000"}'

# garbage token -> 401
curl ... -H "Authorization: Bearer not-a-token" ...

# malformed uuid -> 400 invalid_lead_id
curl ... -H "Authorization: Bearer $TOKEN" -d '{"lead_id":"nope"}'

# valid contractor, nonexistent lead -> 404 lead_not_found
curl ... -H "Authorization: Bearer $TOKEN" -d '{"lead_id":"00000000-0000-4000-8000-000000000000"}'

# someone else's contractor id -> 403 identity_mismatch
curl ... -H "Authorization: Bearer $TOKEN" -d '{"lead_id":"...","contractor_id":"<other uuid>"}'
```

All five must match. If the `401` cases return `500`, `SUPABASE_ANON_KEY` is missing or you have not redeployed.

---

## 5. Run migration 01

Parts 1 → 8 in order. Read the `NOTICE` lines — they say how many columns were granted and warn on any that do not exist.

Then run **Part 8** and read every column:

- every `can_*` must be **false**
- every `edit_*` must be **true**
- `table_wide_insert` on licences must be **false**
- `can_insert_owner` and `can_insert_number` must be **true**
- `storage.buckets.public` must be **false**

A single `can_*` returning true means the hole is still open. A single `edit_*` returning false means onboarding is now broken.

---

## 6. Hostile tests — these must FAIL

```bash
TOKEN=<contractor access_token>   ANON=<anon key>   CID=<that contractor's id>
URL=https://kasqtxwbsmjlisbnebku.supabase.co/rest/v1
H=(-H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")

curl -X PATCH "$URL/contractors?id=eq.$CID" "${H[@]}" -d '{"lead_balance_cents":999999}'   # self-fund
curl -X PATCH "$URL/contractors?id=eq.$CID" "${H[@]}" -d '{"promo_credits_cents":999999}'  # self-fund promo
curl -X PATCH "$URL/contractors?id=eq.$CID" "${H[@]}" -d '{"status":"Active"}'             # self-activate
curl -X PATCH "$URL/contractors?id=eq.$CID" "${H[@]}" -d '{"insurance_verified":true}'     # self-verify
curl -X PATCH "$URL/contractors?id=eq.$CID" "${H[@]}" -d '{"agreement_version":"v99"}'     # forge legal record
curl -X POST  "$URL/contractor_licenses"    "${H[@]}" -d "{\"contractor_id\":\"$CID\",\"trade_category\":\"HVAC\",\"verified\":true}"
curl -X POST  "$URL/wallet_transactions"    "${H[@]}" -d "{\"contractor_id\":\"$CID\",\"amount_cents\":50000,\"type\":\"topup\",\"promo_delta_cents\":0,\"paid_delta_cents\":50000}"
curl -s "$URL/notification_outbox?select=*" "${H[@]}"                                      # read the queue
```

Expect `403` / `42501` on each. **Any success is a stop-ship.**

## 7. Normal tests — these must SUCCEED

Hardening that breaks onboarding is not a win.

```bash
curl -X PATCH "$URL/contractors?id=eq.$CID" "${H[@]}" -d '{"phone":"555-000-0000"}'
```

Then in the UI, as the test contractor: edit every profile field and save; add a licence; replace the insurance document; toggle notifications; accept the agreement. Each must succeed.

**Trigger checks:**

1. Insert a licence without `verified` → read back → `verified` must be `false`.
2. As service role, set `verified = true` (touch **only** verification columns).
3. As the contractor, PATCH `license_number` → read back → `verified` must be `false` again.
4. Same for insurance: verify it, then change `insurance_policy_number` → `insurance_verified` must be false.

**Storage:** contractor A reads A ✓ · A cannot read B ✗ · anon cannot read either ✗ · service role reads both ✓.

---

## 8. Run migration 02 (outbox)

Then confirm the browser cannot see the queue:

```sql
select has_table_privilege('authenticated','public.notification_outbox','SELECT');  -- false
select has_table_privilege('anon','public.notification_outbox','SELECT');           -- false
select count(*) from pg_trigger where tgname like 'trg_emit_%';                     -- 5
```

**PII leak check — must return 0:**

```sql
select count(*) from public.notification_outbox
 where event_type = 'lead_offer_created'
   and (payload ? 'homeowner_name' or payload ? 'homeowner_phone'
     or payload ? 'homeowner_email' or payload ? 'homeowner_address'
     or payload ? 'description');
```

---

## 9. Worker — manual runs only, cron stays OFF

```bash
curl -s -X POST https://www.selectservicepros.com/api/process-notifications \
  -H "Authorization: Bearer $NOTIFICATION_WORKER_SECRET"
```

Returns `{ok, claimed, sent, obsolete, retried, dead, failed}`.

Prove these before scheduling anything:

- wrong secret → `401`
- no `GHL_SSP_EVENTS_WEBHOOK` → `503`, queue **not** drained
- events land with the right envelope
- a stale offer event marks `obsolete` and does not send
- two concurrent invocations never process the same `event_id`

**Do not add a cron schedule in this pass.** Matching cron and notification cron are separate later gates.

---

## 9b. Apply migration 05 before public signup/intake cutover

`20260923_05_api_rate_limits.sql` creates shared fixed-window counters plus the service-role-only `consume_api_rate_limit()` RPC. Raw IP/email/phone identifiers never enter the table; endpoints HMAC them with `RATE_LIMIT_SECRET`.

Verify:

```sql
select has_function_privilege('anon','public.consume_api_rate_limit(text,text,integer,integer)','EXECUTE');          -- false
select has_function_privilege('authenticated','public.consume_api_rate_limit(text,text,integer,integer)','EXECUTE'); -- false
select has_function_privilege('service_role','public.consume_api_rate_limit(text,text,integer,integer)','EXECUTE');  -- true
select has_table_privilege('authenticated','public.api_rate_limits','SELECT');                                       -- false
```

Then exercise both public endpoints from two separate browser/network sessions and confirm counters are shared. A disabled/failed limiter must produce `503 rate_limit_unavailable`, not silently fail open.

## 9c. Wallet top-up — Stripe test-mode E2E before live keys

Apply `20260923_04_wallet_topup_guardrails.sql` before enabling the new checkout/webhook files. It normalizes `credit_wallet()` to the canonical 8-argument signature with a deterministic `idempotency_key`, adds the ledger-wide idempotency unique index plus the Stripe-reference backstop, and keeps the money-minting RPC service-role-only.

Configure Stripe test mode with endpoint:

```text
POST https://www.selectservicepros.com/api/stripe-webhook
```

Subscribe to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`

Controlled test with an **Active** contractor:

1. Wallet shows $100 / $250 / $500 one-time buttons.
2. POST checkout without JWT -> `401`.
3. Pending/Suspended contractor -> `403 contractor_inactive`.
4. Unsupported amount -> `400 invalid_amount`.
5. Valid $100 checkout -> Stripe-hosted payment page; no subscription object is created.
6. Before payment, wallet unchanged.
7. Successful card payment -> webhook signature verifies -> one `topup` ledger row -> paid balance increases exactly $100.
8. Replay the same Stripe event -> balance does **not** increase again.
9. Send two webhook deliveries concurrently for the same payment intent -> exactly one top-up row.
10. Webhook DB/RPC failure -> endpoint returns `500`, allowing Stripe retry.
11. Cancel checkout -> no wallet change.
12. Confirm Stripe customer ID cannot be patched by the contractor REST token.

The browser return URL only refreshes the wallet. It never credits money itself.

## 9d. Admin operations + Founding 25 live test

Apply `20260923_06_founding25_promo.sql` before using activation/promo actions. It adds:

- `contractor_activation_readiness()` — service-role-only readiness check
- `activate_contractor()` — blocks activation until insurance is verified/current and any selected HVAC/Plumbing/Electrical trade has a current verified license row
- `grant_founding25_promo()` — one `$250` promo credit per contractor, globally capped at 25, serialized with an advisory transaction lock
- `approve_founding25_contractor()` — activation + promo in one transaction; if either fails, neither commits

Set `SSP_ADMIN_EMAILS` to the authorized admin email(s) unless admin users carry `app_metadata.role=admin`.

Controlled tests:

1. Non-admin valid JWT -> every `/api/admin-*` endpoint returns `403 admin_required`.
2. Admin login succeeds; no shared password is accepted anywhere.
3. Contractor with unverified insurance -> `activate` returns `409 activation_not_ready`.
4. Insurance verified but selected HVAC/Plumbing/Electrical license missing/unverified -> activation blocked.
5. After required evidence is verified/current -> Activate only succeeds.
6. Approve + $250 -> contractor Active and exactly one `promo_grant` for 25,000 cents.
7. Repeat Approve + $250 / Grant $250 -> same ledger transaction, no second credit.
8. Concurrent duplicate grant requests -> one credit only.
9. After 25 unique Founding grants, a 26th unique grant -> `409 founding25_full`; contractor is not accidentally activated by the failed combined action.
10. Admin can open insurance/license evidence through `/api/admin-document-url`; URL expires after 5 minutes and storage remains private.

## 9e. Dispute flow live test

Apply `20260923_07_dispute_decisions.sql` after the existing `lead_disputes` + `reverse_debit()` core objects are verified live.

1. Contractor without accepted/charged offer cannot dispute.
2. Accepted lead inside 7 days -> one dispute row.
3. Duplicate filing -> `409 dispute_already_filed`.
4. Filing after 7 days -> `409 dispute_window_closed`.
5. Admin reject -> no wallet change.
6. Admin approve -> `reverse_debit()` restores the exact original promo/paid split.
7. Re-approving the same dispute -> no second wallet credit.
8. Verify reversal ledger row references the original debit and unique reversal constraint holds under concurrent approval attempts.

## 10. Rollback

| Step | Undo |
|---|---|
| Code | revert the commit; Vercel redeploys |
| Migration 01 grants | `grant update on public.contractors to authenticated` — reopens the hole; emergency only |
| Triggers | `drop trigger trg_reset_*` |
| Bucket | `update storage.buckets set public = true where id='contractor-docs'` — re-exposes every document |
| Migration 02 | `drop table public.notification_outbox cascade` |
| Migration 04 | revert payment endpoints/UI; the unique top-up index and RPC privilege revoke are safe to leave |
| Migration 05 | revert public endpoints first; then `drop function public.consume_api_rate_limit(text,text,integer,integer); drop table public.api_rate_limits;` |

Migrations are additive. No column is dropped, no row is deleted, nothing is destructive except the grant revokes — and those are reversible.

---

## 11. Launch blockers still open

| # | Blocker | Why |
|---|---|---|
| 0 | **Free-to-join signup live verification** | Static refactor is now complete: no plan picker, no subscription checkout, and signup posts directly to `/api/create-contractor`. Still requires deployment + real email/set-password/login E2E, plus the durable rate limiter below. |
| 0b | **Stripe wallet funding live verification** | Static rewrite complete: checkout is one-time `mode: payment`; webhook only credits `topup` via idempotent `credit_wallet` and never changes tier/status. Still requires migration 04 + Stripe test-mode replay/concurrency E2E before live keys. |
| 0c | **Durable signup rate limiter live verification** | Static implementation complete with shared Postgres counters + HMAC keys. Requires migration 05 and multi-instance/live endpoint verification. |
| 0c2 | **Durable homeowner-intake limiter live verification** | Static shared limiter complete. Migration 05 must be applied and tested. Edge/WAF or bot challenge remains optional defense-in-depth before paid marketing scale. |
| 0d | **Admin operations live verification** | Static rewrite is complete: Supabase admin login, no shared password, verification toggles, private evidence viewing through 5-minute signed URLs, contractor activation readiness, wallet/promo visibility, read-only band-map view, Founding 25 actions, and dispute decisions. Requires migrations 06/07 plus live admin E2E. |
| 0e | **Public site claim sweep** | Homepage and `intake-v2.html` unsupported licensing/response-time claims are corrected in the takeover package. Remaining deployed pages still need the §13 sweep before launch, especially legacy `lead-response.html` and admin surfaces. |
| 1 | **`create-lead` live cutover** | Static rewrite is complete: no tier routing, no `assigned_contractor_id`, signed partial finalization, frozen v1 pricing, 60-minute matching window, stable issue codes, and `fill_offer_slots`. Still blocked on applying/validating the v1 taxonomy seed against the live DB, additive schema/outbox deployment, and controlled E2E fixtures before production traffic. |
| 2 | Wallet funding | Static self-service $100/$250/$500 flow is implemented. Live Stripe test-mode E2E, webhook retry/idempotency, then live-key cutover remain. |
| 3 | **Band map v1 live seed + verification** | Static taxonomy is now complete from the actual current intake: 100 pre-split options became 106 rows after six scope splits. 99 rows are priced (A=$75, B=$35, C=$18); 7 ambiguous `Other` rows intentionally remain `HeldForReview`. `intake-v2.html` and the homepage both emit stable `issue_code`s from `ssp-taxonomy-v1.js`. Remaining work is live schema audit, execute `20260917_03_pricing_taxonomy_v1.sql`, verify all 106 rows, then controlled pricing/matching E2E. |
| 4 | Bootstrap / Founding 25 | Historical snapshot had only 1 Active contractor and zero balances. Migration 06 now provides credential-gated activation plus a concurrency-safe global cap of 25 one-time `$250` promo grants. Still requires choosing/reviewing the actual pilot contractors and executing the grants live. |
| 5 | M8b | Drop contractor policies on `leads` — after the dashboard is confirmed live on the RPCs. |
| 6 | Matching cron | Off. Gated on notification delivery working. |
| 7 | Notification cron | Off. Gated on worker verification. |
| 9 | Outbox live concurrency + retry tests | Two workers, lease reclaim, dead-letter, obsolete path — none exercised. |
| 10 | GHL configuration + end-to-end | Owned by ChatGPT. SSP emits; GHL consumes. Not verified here. |
| 11 | Agreement counsel review | v2 is an operational rewrite, not a legal one. Flagged, not done. |

---

## 13. Public site claim sweep — results

Static search across every deployed HTML file. **Findings, not fixes** — major
marketing and legal claims are not silently rewritten.

| Term | Files |
|---|---|
| `licensed` | contact, intake-v2, privacy-policy, terms-of-service, contractor-dashboard |
| `TDLR` | no longer present in contractor signup; review any remaining site files |
| `background check` | contractor-dashboard (agreement clause — supported) |
| `verified` | admin-dashboard, contractor-signup, terms-of-service, contractor-dashboard |
| `within minutes` | no longer present in the corrected homeowner intake/homepage; continue sweep on legacy pages |
| `Basic` / `Pro` / `Elite` | **lead-response** and any other legacy pages; corrected admin/homepage/intake/signup no longer use tier routing |
| `subscription` | contractor-dashboard (negations + comments only) |
| `membership` | **lead-response** and any other legacy pages; corrected admin/signup use the wallet model |
| `card on file` | **lead-response**, contractor-dashboard (comment) |
| `first to accept` | **lead-response** |
| `priority access` | remove from any remaining legacy pages; corrected contractor signup no longer contains it |
| `exclusive` | contractor-login, contractor-signup, terms-of-service, contractor-dashboard (legal "non-exclusive licence") |

**Bolded files carry live unsupported or retired claims.** Every
`contractor-dashboard.html` hit was checked in context and is benign — a
negation ("no recurring subscription"), a legal clause, or a code comment.

Requiring review before launch:

- **index.html** — corrected in the takeover package: removed TDLR/background-check/response-time claims, retired membership copy, unused client GHL literal, and unsafe success interpolation. Live deployment still must be verified.
- **intake-v2.html** — corrected in the takeover package: removed blanket licensing and response-time promises; also carries the signed Partial token used by the new `create-lead` flow.
- **contractor-signup.html** — refactored to free-to-join in the takeover package; live signup/email/password flow still must be tested.
- **lead-response.html / api/lead-response.js** — replaced in the takeover package with a safe retired-page notice and HTTP `410` API stub. Contractors must use authenticated dashboard accept/decline.
- **api/save-pricing.js / api/admin-config.js / admin.html** — retired in the takeover package; legacy shared-password/tier configuration surfaces now return `410` or redirect to the authenticated Operations dashboard.
- **ssp-config.js** — replaced with non-secret wallet-model constants only; no Basic/Pro/Elite, no GHL webhook literal.
- **admin-dashboard.html** — corrected in the takeover package: no tier/MRR controls, authenticated admin access, credential review, private evidence links, Founding 25 controls and dispute queue. Live deployment/auth must still be tested.

Not changed in this pass: these are marketing and legal claims, and replacing
them is a content decision, not a code fix.

## 12. What this pass did and did not prove

**Static, verified:** run `scripts/verify-ssp-hardening.js` from a fresh extraction of the exact release ZIP; the release gate requires 0 failures and 0 mandatory skips. It parses the real dashboard write payloads and diffs them against the SQL grant allowlist rather than grepping literals.

**Live database: Phase B applied and verified as documented in §2a. Application deployment and post-deploy column-grant hardening are still pending.**

**GHL:** not modified, not inspected, not verified. Owned separately.

Do not describe this as production ready. The correct description is: *code complete and statically verified; live security verification outstanding.*