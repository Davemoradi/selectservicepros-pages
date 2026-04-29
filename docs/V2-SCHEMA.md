# SSP V2 Schema

This document is the canonical reference for SSP's database schema. It has three sections:

1. **Current schema** — what exists in Supabase today, reverse-engineered from code
2. **Target schema** — what v2 needs (additions for reviews, messaging, transactions, etc.)
3. **Migration path** — how to get from current to target safely

Always update this document when schema changes. The document is the contract; the live Supabase is the implementation.

---

## 1. Current schema

### Tables in active use
- `contractors` — paying members
- `leads` — homeowner job requests
- `contractor_licenses` — per-trade licenses
- `platform_config` — key/value config
- `stripe_events` — webhook idempotency
- `auth.users` — Supabase managed
- Storage bucket: `contractor-docs`

### Full SQL (current state, reverse-engineered)

```sql
-- =============================================================================
-- contractors  — primary table for paying members
-- =============================================================================
CREATE TABLE contractors (
  -- Identity
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id                  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email                    text NOT NULL,
  first_name               text,
  last_name                text,
  phone                    text,
  company_name             text,

  -- Plan / subscription
  membership_tier          text DEFAULT 'Basic',           -- 'Basic' | 'Pro' | 'Elite'
  status                   text DEFAULT 'Pending Profile', -- see status state machine
  stripe_customer_id       text,
  stripe_subscription_id   text,

  -- Profile content
  business_description     text,
  years_in_business        int,
  number_of_employees      text,                            -- '1-5', '6-10', etc
  website_url              text,
  state                    text,                            -- 2-letter

  -- Services + service area
  service_categories       text,            -- comma-separated, e.g. "HVAC, Plumbing"
  services                 text,            -- comma-separated specific services
  services_detail          jsonb,           -- { "HVAC": ["AC Repair", ...], ... }
  service_zips             text,            -- comma-separated 5-digit ZIPs

  -- Operations
  num_technicians          int,
  num_vehicles             int,
  business_hours           jsonb,           -- {Mon:{...}, ..., _confirmed:bool}
  scheduling_system        text,
  phone_answered_by        text,
  payment_methods          text[],

  -- Credentials (legacy single-license columns; new model uses contractor_licenses)
  license_number           text,
  license_type             text,

  -- Insurance
  insurance_carrier            text,
  insurance_policy_number      text,
  insurance_expiration         date,
  insurance_doc_url            text,
  insurance_verified           bool DEFAULT false,
  insurance_verified_at        timestamptz,

  -- Service agreement (e-sign)
  agreement_accepted_at        timestamptz,
  agreement_accepted_ip        text,
  agreement_version            text,
  agreement_signed_name        text,

  -- Notification prefs
  notif_email              bool DEFAULT true,
  notif_sms                bool DEFAULT true,
  notif_digest             bool DEFAULT false,

  -- DEAD COLUMNS (zero on insert, never updated; admin-data recomputes from leads)
  -- TODO: drop in Phase 1.4, OR wire via triggers
  lead_count               int  DEFAULT 0,
  acceptance_rate          int  DEFAULT 0,    -- whole percent
  avg_response_time        int  DEFAULT 0,    -- seconds
  total_lead_charges       numeric DEFAULT 0,

  -- Lifecycle timestamps
  activated_at             timestamptz,
  deletion_requested_at    timestamptz,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()
);

-- CRITICAL: required for ilike-based dedup + 23505 race detection
-- in create-contractor.js / stripe-webhook.js
CREATE UNIQUE INDEX contractors_email_lower_uniq
  ON contractors (LOWER(email));

CREATE INDEX contractors_status_idx ON contractors(status);
CREATE INDEX contractors_auth_id_idx ON contractors(auth_id);
```

#### Status state machine (`contractors.status`)

```
                                     ┌──────────────────────┐
                                     │   Pending Profile    │  ← create-contractor inserts here
                                     │  (no Stripe row yet) │
                                     └──────────┬───────────┘
                                                │
                                                │ Stripe checkout.session.completed
                                                ▼
                                     ┌──────────────────────┐
                                     │ Pending Verification │  ← stripe-webhook flips here
                                     └──────────┬───────────┘
                                                │
                                                │ contractor signs agreement in dashboard
                                                ▼
                                     ┌──────────────────────┐
                                     │   Pending Review     │  ← submit-for-review fires GHL #6
                                     └──────────┬───────────┘
                                                │
                                                │ admin approves (admin-dashboard #7)
                                                ▼
                                     ┌──────────────────────┐
                                     │       Active         │  ← lead routing turns ON
                                     └──┬─────────────┬─────┘
                                        │             │
                       admin suspend OR │             │ contractor requests deletion
                       sub.deleted      │             │ (settings tab)
                                        ▼             ▼
                                 ┌─────────────┐  ┌────────────────────┐
                                 │  Suspended  │  │ Deletion Requested │
                                 └─────────────┘  └─────────┬──────────┘
                                                            │ admin processes
                                                            ▼
                                                       ┌─────────┐
                                                       │ Deleted │
                                                       └─────────┘
```

**Legacy values still appearing in `admin-dashboard.html` filter UI but not written:** `Paid`, `Verified`. Filter UI shows them; no code path produces them. Clean up in Phase 1.4.

```sql
-- =============================================================================
-- leads  — homeowner job requests
-- =============================================================================
CREATE TABLE leads (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Homeowner contact
  homeowner_name           text,
  homeowner_phone          text,
  homeowner_email          text,
  homeowner_zip            text,

  -- Address (Google Places-derived; all optional)
  homeowner_address        text,    -- formatted_address from Google
  homeowner_street         text,
  homeowner_city           text,
  homeowner_state          text,    -- 2-letter
  homeowner_lat            numeric,
  homeowner_lng            numeric,
  place_id                 text,    -- Google place_id

  -- Request
  service_type             text,    -- specific issue
  service_category         text,    -- top-level category
  description              text,
  urgency                  text,    -- 'Emergency' | 'Soon' | 'Planning'

  -- Lifecycle
  status                   text,    -- 'Partial' | 'New' | 'Unmatched' | 'Accepted' | 'Passed' | 'Expired'
  partial                  bool DEFAULT false,
  source                   text,    -- 'website'

  -- Routing (NOTE: in Phase 1.3 these become derived from lead_matches)
  assigned_contractor_id   uuid REFERENCES contractors(id) ON DELETE SET NULL,
  delivered_at             timestamptz,
  accepted_at              timestamptz,
  responded_at             timestamptz,
  response_time_seconds    int,

  -- Billing
  lead_fee                 numeric,
  paid                     bool DEFAULT false,

  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()

  -- TODO Phase 1.4: dashboard reads these defensively but no code writes them.
  -- Either remove the dead reads or build the intake fields:
  --   budget              text
  --   property_type       text
  --   preferred_contact   text
);

CREATE INDEX leads_assigned_contractor_idx ON leads(assigned_contractor_id);
CREATE INDEX leads_status_idx              ON leads(status);
CREATE INDEX leads_created_at_idx          ON leads(created_at DESC);
CREATE INDEX leads_partial_idx             ON leads(partial) WHERE partial = true;

-- =============================================================================
-- contractor_licenses  — per-trade licenses
-- (Migration block lives in contractor-dashboard.html lines 30-47)
-- =============================================================================
CREATE TABLE contractor_licenses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id   uuid REFERENCES contractors(id) ON DELETE CASCADE,
  trade_category  text,             -- 'HVAC' | 'Plumbing' | 'Electrical'
  license_type    text,
  license_state   text,
  license_number  text,
  expiration_date date,
  document_url    text,             -- public URL into contractor-docs bucket
  verified        bool DEFAULT false,
  verified_at     timestamptz,
  verified_by     text,
  notes           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX contractor_licenses_contractor_idx ON contractor_licenses(contractor_id);

-- =============================================================================
-- platform_config  — key/value config
-- =============================================================================
CREATE TABLE platform_config (
  key         text PRIMARY KEY,
  value       jsonb,
  updated_at  timestamptz DEFAULT now()
);

-- Keys actually used:
--   'pricing'            -> { Basic:{monthly,perLead,responseWindow}, Pro:{...}, Elite:{...} }
--                           [CANONICAL after Phase 0.2 — PascalCase]
--   'service_categories' -> [{id, name, ...}]
--   'markets'            -> [{id, city, state, zips, enabled}]

-- =============================================================================
-- stripe_events  — webhook idempotency + audit trail
-- =============================================================================
CREATE TABLE stripe_events (
  event_id           text PRIMARY KEY,        -- Stripe's evt_... ID
  event_type         text,                     -- 'checkout.session.completed' etc.
  contractor_id      uuid REFERENCES contractors(id) ON DELETE SET NULL,
  payload            jsonb,                    -- the full event object
  processing_result  text,                     -- 'ok:activated' | 'error:no_email' | etc.
  created_at         timestamptz DEFAULT now()
);

CREATE INDEX stripe_events_contractor_idx ON stripe_events(contractor_id);
CREATE INDEX stripe_events_type_idx ON stripe_events(event_type);
```

### Current RLS policies

```sql
-- contractors (anon-key access from contractor-dashboard.html under user JWT)
ALTER TABLE contractors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contractors read own row" ON contractors
  FOR SELECT USING (auth_id = auth.uid());

CREATE POLICY "Contractors update own row" ON contractors
  FOR UPDATE
  USING (auth_id = auth.uid())
  WITH CHECK (auth_id = auth.uid());

-- (No INSERT policy — server-side only via service-role key)

-- leads
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contractors read own assigned leads" ON leads
  FOR SELECT
  USING (assigned_contractor_id IN (SELECT id FROM contractors WHERE auth_id = auth.uid()));

CREATE POLICY "Contractors update own assigned leads" ON leads
  FOR UPDATE
  USING (assigned_contractor_id IN (SELECT id FROM contractors WHERE auth_id = auth.uid()))
  WITH CHECK (assigned_contractor_id IN (SELECT id FROM contractors WHERE auth_id = auth.uid()));

-- contractor_licenses (committed, in dashboard migration block)
ALTER TABLE contractor_licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contractors manage own licenses" ON contractor_licenses
  FOR ALL
  USING (contractor_id IN (SELECT id FROM contractors WHERE auth_id = auth.uid()))
  WITH CHECK (contractor_id IN (SELECT id FROM contractors WHERE auth_id = auth.uid()));

-- Storage bucket policies
CREATE POLICY "Contractors upload to own folder" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'contractor-docs'
    AND (storage.foldername(name))[1] IN (SELECT id::text FROM contractors WHERE auth_id = auth.uid())
  );

CREATE POLICY "Contractors read own folder" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'contractor-docs'
    AND (storage.foldername(name))[1] IN (SELECT id::text FROM contractors WHERE auth_id = auth.uid())
  );

CREATE POLICY "Contractors update own folder" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'contractor-docs'
    AND (storage.foldername(name))[1] IN (SELECT id::text FROM contractors WHERE auth_id = auth.uid())
  );
```

### Known schema landmines (current state)

| # | Issue | Severity | Phase |
|---|---|---|---|
| 1 | No DELETE policy on `contractor-docs` storage — files orphan when "Remove" clicked | Medium (cost) | 1.4 |
| 2 | `leads.budget`, `property_type`, `preferred_contact` read but never written | Low | 1.4 |
| 3 | Dead columns on contractors (`lead_count` etc.) | Low | 1.4 |
| 4 | `platform_config.pricing` shape inconsistent (PascalCase vs lowercase) | **High (silent bug)** | **0.2** |
| 5 | Two contractors writers can race; relies on unique `LOWER(email)` index | High if index missing | 0.2 / 1.4 verify |

---

## 2. Target schema (v2)

These are the additions needed for Phase 1 + Phase 2 features. Each table here is referenced from `docs/V2-PLAN.md`.

### 2.1 `lead_matches` — cascading dispatch (Phase 1.3)

Replaces single `leads.assigned_contractor_id` with a one-to-many relationship that records every contractor a lead was offered to, in order, with their response.

```sql
CREATE TABLE lead_matches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid REFERENCES leads(id) ON DELETE CASCADE,
  contractor_id   uuid REFERENCES contractors(id) ON DELETE CASCADE,
  tier            text NOT NULL,           -- 'Elite' | 'Pro' | 'Basic' (snapshot at match time)
  cascade_order   int NOT NULL,            -- 1 = first tier offered, 2 = second, etc.
  notified_at     timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,    -- notified_at + tier window minutes
  responded_at    timestamptz,
  status          text NOT NULL DEFAULT 'pending',
                  -- 'pending' | 'accepted' | 'passed' | 'expired' | 'superseded'
  lead_fee        numeric,                 -- snapshot at match time (in case price changes mid-cascade)

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),

  UNIQUE (lead_id, contractor_id)
);

CREATE INDEX lead_matches_lead_idx              ON lead_matches(lead_id);
CREATE INDEX lead_matches_contractor_idx        ON lead_matches(contractor_id);
CREATE INDEX lead_matches_pending_expires_idx   ON lead_matches(expires_at)
  WHERE status = 'pending';

-- RLS
ALTER TABLE lead_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contractors see own matches" ON lead_matches
  FOR SELECT
  USING (contractor_id IN (SELECT id FROM contractors WHERE auth_id = auth.uid()));

CREATE POLICY "Contractors respond to own matches" ON lead_matches
  FOR UPDATE
  USING (contractor_id IN (SELECT id FROM contractors WHERE auth_id = auth.uid()))
  WITH CHECK (contractor_id IN (SELECT id FROM contractors WHERE auth_id = auth.uid()));
```

### 2.2 `reviews` — homeowner reviews (Phase 2.1)

```sql
CREATE TABLE reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid REFERENCES leads(id) ON DELETE SET NULL,
  contractor_id   uuid NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  homeowner_email text,
  homeowner_name  text,
  rating          int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title           text,
  body            text,
  job_value       numeric,                  -- optional: how much the job was

  -- Moderation
  status          text NOT NULL DEFAULT 'pending',
                  -- 'pending' | 'approved' | 'rejected' | 'flagged' | 'disputed'
  moderation_notes text,
  moderated_at    timestamptz,
  moderated_by    text,

  -- Contractor reply (one allowed)
  contractor_reply text,
  contractor_reply_at timestamptz,

  -- Verification
  verified        bool DEFAULT false,       -- did this homeowner actually complete a job?
  verification_method text,                  -- 'lead_match' | 'manual'

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX reviews_contractor_idx ON reviews(contractor_id);
CREATE INDEX reviews_status_idx     ON reviews(status);
CREATE INDEX reviews_rating_idx     ON reviews(rating);

-- Materialized rating summary on contractors (or a view)
ALTER TABLE contractors ADD COLUMN avg_rating numeric;
ALTER TABLE contractors ADD COLUMN review_count int DEFAULT 0;

-- Maintain via trigger or recompute in background job
```

### 2.3 `messages` — in-app messaging (Phase 2.2)

```sql
CREATE TABLE message_threads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid REFERENCES leads(id) ON DELETE CASCADE,
  contractor_id   uuid NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  homeowner_email text NOT NULL,
  homeowner_name  text,
  homeowner_phone text,                     -- for SMS bridging
  status          text DEFAULT 'open',      -- 'open' | 'closed' | 'disputed'
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),

  UNIQUE (lead_id, contractor_id)
);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id       uuid NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  sender_role     text NOT NULL,            -- 'contractor' | 'homeowner' | 'admin' | 'system'
  sender_id       text,                      -- contractor.id (if contractor) or null
  body            text NOT NULL,
  attachments     jsonb,                     -- [{url, type, filename, size}]
  channel         text DEFAULT 'web',        -- 'web' | 'sms_in' | 'sms_out' | 'email_in' | 'email_out'
  read_at         timestamptz,

  created_at      timestamptz DEFAULT now()
);

CREATE INDEX messages_thread_idx ON messages(thread_id, created_at);
```

### 2.4 `availability_blocks` — calendar (Phase 2.4)

```sql
CREATE TABLE availability_blocks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id   uuid NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  block_type      text NOT NULL,            -- 'unavailable' | 'limited' | 'available_only'
  start_at        timestamptz NOT NULL,
  end_at          timestamptz NOT NULL,
  reason          text,                      -- 'vacation' | 'fully_booked' | 'sick' | etc.
  source          text DEFAULT 'manual',     -- 'manual' | 'google_calendar' | 'system'
  external_id     text,                      -- if synced from Google Calendar

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),

  CHECK (end_at > start_at)
);

CREATE INDEX availability_contractor_idx ON availability_blocks(contractor_id, start_at);
```

### 2.5 Stripe Connect — `transactions`, `jobs`, `estimates` (Phase 2.5)

```sql
CREATE TABLE estimates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid REFERENCES leads(id) ON DELETE SET NULL,
  contractor_id   uuid NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  homeowner_email text NOT NULL,
  description     text NOT NULL,
  line_items      jsonb,                     -- [{description, quantity, unit_price}]
  subtotal        numeric NOT NULL,
  tax_amount      numeric DEFAULT 0,
  total           numeric NOT NULL,
  status          text DEFAULT 'draft',      -- 'draft' | 'sent' | 'approved' | 'rejected' | 'expired'
  expires_at      timestamptz,
  approved_at     timestamptz,

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE TABLE jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id         uuid REFERENCES leads(id),
  estimate_id     uuid REFERENCES estimates(id),
  contractor_id   uuid NOT NULL REFERENCES contractors(id),
  homeowner_email text NOT NULL,
  status          text DEFAULT 'scheduled',
                  -- 'scheduled' | 'in_progress' | 'completed' | 'cancelled' | 'disputed'
  scheduled_at    timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  amount_total    numeric,                   -- final amount including any add-ons
  before_photos   jsonb,                      -- [{url, taken_at}]
  after_photos    jsonb,
  notes           text,

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE TABLE transactions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                  uuid REFERENCES jobs(id),
  contractor_id           uuid NOT NULL REFERENCES contractors(id),
  type                    text NOT NULL,
                          -- 'subscription' | 'lead_fee' | 'job_payment' | 'refund' | 'transfer'
  stripe_payment_intent   text,
  stripe_charge_id        text,
  stripe_transfer_id      text,
  stripe_refund_id        text,

  amount_gross            numeric NOT NULL,           -- what homeowner paid
  amount_fee_platform     numeric DEFAULT 0,           -- SSP's 3% cut
  amount_fee_stripe       numeric DEFAULT 0,           -- Stripe's processing fee
  amount_net              numeric,                     -- transferred to contractor

  currency                text DEFAULT 'usd',
  status                  text NOT NULL,
                          -- 'pending' | 'succeeded' | 'failed' | 'refunded' | 'disputed'
  description             text,
  metadata                jsonb,

  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

CREATE INDEX transactions_contractor_idx ON transactions(contractor_id, created_at DESC);
CREATE INDEX transactions_type_idx       ON transactions(type);
CREATE INDEX transactions_job_idx        ON transactions(job_id);

-- Stripe Connect account ID on contractors
ALTER TABLE contractors ADD COLUMN stripe_connect_account_id text;
ALTER TABLE contractors ADD COLUMN stripe_connect_onboarded_at timestamptz;
```

### 2.6 `audit_log` — system audit trail (Phase 2.6)

```sql
CREATE TABLE audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_role      text NOT NULL,             -- 'admin' | 'contractor' | 'homeowner' | 'system'
  actor_id        text,                       -- contractor.id, admin email, etc.
  action          text NOT NULL,              -- 'contractor.status.changed', 'price.updated', etc.
  entity_type     text,                       -- 'contractor' | 'lead' | 'platform_config' | etc.
  entity_id       text,
  before_value    jsonb,
  after_value     jsonb,
  ip_address      text,
  user_agent      text,
  notes           text,

  created_at      timestamptz DEFAULT now()
);

CREATE INDEX audit_log_actor_idx       ON audit_log(actor_id, created_at DESC);
CREATE INDEX audit_log_entity_idx      ON audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX audit_log_action_idx      ON audit_log(action, created_at DESC);
```

### 2.7 Push notification subscriptions (Phase 2.3)

```sql
CREATE TABLE push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id   uuid NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  endpoint        text NOT NULL UNIQUE,
  keys_p256dh     text NOT NULL,
  keys_auth       text NOT NULL,
  user_agent      text,
  active          bool DEFAULT true,

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX push_subs_contractor_idx ON push_subscriptions(contractor_id) WHERE active = true;
```

---

## 3. Migration path

### Migration discipline

Every schema change must:
1. Be added to a numbered SQL file in `migrations/` (e.g., `migrations/001_add_lead_matches.sql`)
2. Update this document (`docs/V2-SCHEMA.md`) in the same commit
3. Be reviewed before running against production
4. Be tested on a Supabase branch (Supabase has branching) or staging project before production

### Phase 0 schema work

```sql
-- migrations/000_baseline_phase_0.sql
-- Phase 0: verify what we expect to exist actually exists

-- 1. Confirm unique index on email
SELECT indexname FROM pg_indexes
WHERE tablename = 'contractors'
  AND indexdef LIKE '%LOWER%email%';
-- If empty: CREATE UNIQUE INDEX contractors_email_lower_uniq ON contractors (LOWER(email));

-- 2. Confirm pricing config shape
SELECT value FROM platform_config WHERE key = 'pricing';
-- Update to canonical PascalCase shape if needed, e.g.:
-- UPDATE platform_config
-- SET value = '{
--   "Basic": {"monthly": 49, "perLead": 39, "responseWindow": 30},
--   "Pro": {"monthly": 99, "perLead": 29, "responseWindow": 45},
--   "Elite": {"monthly": 199, "perLead": 19, "responseWindow": 60}
-- }'::jsonb,
-- updated_at = now()
-- WHERE key = 'pricing';
```

### Phase 1 schema work

```sql
-- migrations/001_add_lead_matches.sql
-- Adds the lead_matches table for cascading dispatch.
-- See docs/V2-PLAN.md §1.3.

-- (full CREATE TABLE from §2.1 above)

-- Backfill existing leads into lead_matches
INSERT INTO lead_matches (lead_id, contractor_id, tier, cascade_order, notified_at, expires_at, status, lead_fee)
SELECT
  l.id,
  l.assigned_contractor_id,
  c.membership_tier,
  1,
  COALESCE(l.delivered_at, l.created_at),
  COALESCE(l.delivered_at, l.created_at) + interval '60 minutes',
  CASE
    WHEN l.status = 'Accepted' THEN 'accepted'
    WHEN l.status = 'Passed'   THEN 'passed'
    WHEN l.status = 'Expired'  THEN 'expired'
    ELSE 'pending'
  END,
  l.lead_fee
FROM leads l
JOIN contractors c ON c.id = l.assigned_contractor_id
WHERE l.assigned_contractor_id IS NOT NULL;
```

```sql
-- migrations/002_storage_delete_policy.sql
-- Phase 1.4: allow contractors to actually delete their own storage files

CREATE POLICY "Contractors delete own folder" ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'contractor-docs'
    AND (storage.foldername(name))[1] IN (SELECT id::text FROM contractors WHERE auth_id = auth.uid())
  );
```

```sql
-- migrations/003_drop_dead_columns.sql
-- Phase 1.4: drop the never-updated stat columns on contractors.
-- (Run only after admin-data.js is updated to not select them.)

ALTER TABLE contractors DROP COLUMN IF EXISTS lead_count;
ALTER TABLE contractors DROP COLUMN IF EXISTS acceptance_rate;
ALTER TABLE contractors DROP COLUMN IF EXISTS avg_response_time;
ALTER TABLE contractors DROP COLUMN IF EXISTS total_lead_charges;
```

```sql
-- migrations/004_clean_legacy_status.sql
-- Phase 1.4: clean up legacy status filter UI
-- (No SQL needed; just remove 'Paid' and 'Verified' from admin-dashboard.html status filter dropdown)
```

### Phase 2 schema work

Each Phase 2 feature gets its own migration file:

```
migrations/010_add_reviews.sql
migrations/011_add_message_threads_and_messages.sql
migrations/012_add_push_subscriptions.sql
migrations/013_add_availability_blocks.sql
migrations/020_add_stripe_connect_columns.sql
migrations/021_add_estimates_jobs_transactions.sql
migrations/030_add_audit_log.sql
```

Each migration has:
- Schema additions
- Backfill (if any)
- RLS policies
- Indexes

---

## 4. Verification queries

Useful queries to verify schema state. Run these in Supabase SQL editor.

```sql
-- All tables
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

-- All columns on contractors
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'contractors'
ORDER BY ordinal_position;

-- All indexes
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- All RLS policies
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;

-- Storage policies (subset of above for storage.objects)
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'objects' AND schemaname = 'storage';

-- Current pricing config
SELECT value FROM platform_config WHERE key = 'pricing';

-- Status distribution on contractors
SELECT status, COUNT(*) FROM contractors GROUP BY status;

-- Status distribution on leads
SELECT status, COUNT(*) FROM leads GROUP BY status;
```

---

## 5. Conventions for future schema changes

1. **No tables outside `public` schema** without explicit reason. Supabase Auth uses `auth`, Storage uses `storage` — those are managed by Supabase and you don't add tables to them.
2. **All FKs to `contractors`** must specify `ON DELETE` behavior. Default to `SET NULL` for historical data, `CASCADE` for tightly-coupled child rows.
3. **All timestamp columns** use `timestamptz` not `timestamp`. Default to `now()` for `created_at`.
4. **Prefer `text` over `varchar(n)`** unless there's a specific length constraint that's enforced application-side.
5. **Booleans default to `false`** explicitly. No nullable booleans unless the third state is meaningful.
6. **Soft-delete via `deleted_at` timestamp**, not a `deleted` boolean. Easier to audit when something was deleted.
7. **JSONB for extensible structured data**, plain text for fixed strings, `text[]` for short fixed lists like `payment_methods`.
8. **Index everything you query by.** Especially FK columns and timestamp filters. Postgres won't add these automatically.
9. **RLS on every table that's read with the anon key.** Never rely on "the frontend doesn't query that" — assume hostile clients.
10. **Document the change here** before running it. The doc is the contract.
