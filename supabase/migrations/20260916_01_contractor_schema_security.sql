-- ============================================================================
-- 20260916_01_contractor_schema_security.sql
-- CANONICAL migration for contractor schema + security.
--
-- This file is the single source of truth. Executable SQL was previously
-- duplicated inside contractor-dashboard.html; that copy has been removed and
-- replaced with a pointer to this file. Do not reintroduce SQL into HTML.
--
-- Covers:
--   1. contractors columns (incl. the full agreement legal record)
--   2. contractor_licenses schema
--   3. indexes
--   4. private contractor-docs storage + policies
--   5. RLS
--   6. COLUMN-LEVEL privileges  <- the part RLS cannot do
--   7. verification reset triggers
--
-- NOT EXECUTED. Run Part 0 audit first, read the output, then proceed.
-- ============================================================================


-- ============================================================================
-- PART 0 — AUDIT (read-only). Run and read BEFORE anything below.
-- ============================================================================

select grantee, table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema='public'
   and table_name in ('contractors','contractor_licenses')
   and grantee in ('anon','authenticated')
 order by table_name, grantee, privilege_type;

select table_name, column_name, data_type, udt_name
  from information_schema.columns
 where table_schema='public'
   and table_name in ('contractors','contractor_licenses')
 order by table_name, ordinal_position;

-- TYPE ASSERTIONS. `add column if not exists` is a NO-OP on an existing
-- column, so a wrong declaration below would not change the live type — it
-- would just make this file lie about the schema. Check these three before
-- trusting anything else in this migration.
--
--   services_detail   app writes a JSON object   -> expect jsonb
--   business_hours    app writes a JSON object   -> expect jsonb
--   payment_methods   app writes an array        -> expect jsonb OR text[];
--                     KEEP whatever exists. Do not convert casually — an
--                     in-place type change needs a USING clause and a
--                     backfill, and is out of scope for this migration.
select column_name, data_type, udt_name
  from information_schema.columns
 where table_schema='public' and table_name='contractors'
   and column_name in ('services_detail','business_hours','payment_methods');

-- If a type disagrees with the expectation above, STOP and convert
-- deliberately in a separate migration:
--   alter table public.contractors
--     alter column services_detail type jsonb using services_detail::jsonb;

select id, name, public from storage.buckets where id='contractor-docs';


-- ============================================================================
-- PART 1 — contractors columns
-- ============================================================================

alter table public.contractors
  -- profile
  add column if not exists first_name              text,
  add column if not exists last_name               text,
  add column if not exists company_name            text,
  add column if not exists business_description    text,
  add column if not exists years_in_business       integer,
  add column if not exists number_of_employees     text,
  add column if not exists phone                   text,
  add column if not exists website_url             text,
  add column if not exists state                   text,
  -- service area
  add column if not exists service_zips            text,
  add column if not exists service_categories      text,
  -- JSON object in the app (state.servicesDetail), so jsonb. Declaring it
  -- text would silently store "[object Object]" on every save.
  add column if not exists services_detail         jsonb,
  -- operations
  add column if not exists num_technicians         integer,
  add column if not exists num_vehicles            integer,
  add column if not exists business_hours          jsonb,
  add column if not exists scheduling_system       text,
  add column if not exists phone_answered_by       text,
  -- Array in the app. jsonb only if the column does not already exist;
  -- if it is text[] live, that type is preserved (add-if-not-exists is a
  -- no-op) and the app continues to work. Do not convert here.
  add column if not exists payment_methods         jsonb,
  -- insurance (evidence = contractor-editable, verdict = admin-only)
  add column if not exists insurance_carrier          text,
  add column if not exists insurance_policy_number    text,
  add column if not exists insurance_expiration       date,
  add column if not exists insurance_doc_url          text,
  add column if not exists insurance_verified         boolean not null default false,
  add column if not exists insurance_verified_at      timestamptz,
  -- notifications
  add column if not exists notif_email             boolean not null default true,
  add column if not exists notif_sms               boolean not null default false,  -- opt-in only
  add column if not exists notif_digest            boolean not null default false,
  -- agreement legal record (server-written ONLY)
  add column if not exists agreement_accepted_at         timestamptz,
  add column if not exists agreement_accepted_ip         text,
  add column if not exists agreement_accepted_user_agent text,
  add column if not exists agreement_version             text,
  add column if not exists agreement_signed_name         text,
  -- lifecycle
  add column if not exists deletion_requested_at   timestamptz;

comment on column public.contractors.insurance_verified is
  'ADMIN-CONTROLLED. Contractors hold no UPDATE grant. Reset to false by trigger whenever insurance evidence changes.';
comment on column public.contractors.agreement_accepted_user_agent is
  'Server-captured from the request User-Agent header. The agreement text states SSP records it.';
comment on column public.contractors.notif_sms is
  'Defaults FALSE. SMS requires affirmative opt-in; never enroll silently.';


-- ============================================================================
-- PART 2 — contractor_licenses
-- ============================================================================

create table if not exists public.contractor_licenses (
  id              uuid primary key default gen_random_uuid(),
  contractor_id   uuid not null references public.contractors(id) on delete cascade,
  trade_category  text,
  license_type    text,
  license_state   text,
  license_number  text,
  expiration_date date,
  document_url    text,
  notes           text,
  verified        boolean not null default false,
  verified_at     timestamptz,
  verified_by     text,
  created_at      timestamptz not null default now()
);

alter table public.contractor_licenses
  add column if not exists verified_by text,
  add column if not exists notes       text;

comment on column public.contractor_licenses.verified is
  'ADMIN-CONTROLLED. No contractor INSERT or UPDATE grant. Forced false on insert and reset by trigger when license evidence changes.';


-- ============================================================================
-- PART 3 — indexes
-- ============================================================================

create index if not exists idx_contractors_auth_id     on public.contractors (auth_id);
create index if not exists idx_contractors_status      on public.contractors (status);
create index if not exists idx_contractors_active_bal  on public.contractors (status)
  where status = 'Active';
create index if not exists idx_lic_contractor          on public.contractor_licenses (contractor_id);
create index if not exists idx_lic_unverified          on public.contractor_licenses (contractor_id)
  where verified = false;


-- ============================================================================
-- PART 4 — PRIVATE document storage
--
-- Insurance certificates and trade licenses are business identity documents.
-- A public bucket makes every one readable by anyone holding or guessing the
-- object URL, with no auth and no audit trail.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('contractor-docs','contractor-docs', false)
on conflict (id) do nothing;

-- The bucket was originally created public, so the insert above is a no-op on
-- an existing project. THIS is the line that closes it.
update storage.buckets set public = false where id = 'contractor-docs';

-- Frontend validation (10MB / PDF / JPG / PNG) is a UX affordance, not a
-- security control: a contractor with an access token can upload straight to
-- the storage API and skip it entirely. Enforce at the bucket.
update storage.buckets
   set file_size_limit = 10485760,                       -- 10 MiB
       allowed_mime_types = array['application/pdf','image/jpeg','image/png']
 where id = 'contractor-docs';
-- If this errors, the Supabase version predates these columns — in that case
-- enforcement MUST move server-side (upload through an API route that checks
-- size and sniffs content type) before launch. Do not rely on the frontend.

alter table storage.objects enable row level security;

-- Drop ALL historical names before recreating. The first three came from the
-- migration formerly embedded in contractor-dashboard.html.
drop policy if exists "Contractors upload to own folder" on storage.objects;
drop policy if exists "Contractors read own folder"      on storage.objects;
drop policy if exists "Contractors update own folder"    on storage.objects;
drop policy if exists "contractor reads own docs"        on storage.objects;
drop policy if exists "contractor uploads own docs"      on storage.objects;
drop policy if exists "contractor updates own docs"      on storage.objects;
drop policy if exists "contractor deletes own docs"      on storage.objects;
drop policy if exists "service role manages docs"        on storage.objects;

-- Objects live at `<contractor_id>/<file>`, so segment 1 is the owner.
create policy "contractor reads own docs" on storage.objects
  for select to authenticated
  using (bucket_id='contractor-docs'
     and (storage.foldername(name))[1] in
         (select id::text from public.contractors where auth_id = auth.uid()));

create policy "contractor uploads own docs" on storage.objects
  for insert to authenticated
  with check (bucket_id='contractor-docs'
     and (storage.foldername(name))[1] in
         (select id::text from public.contractors where auth_id = auth.uid()));

-- USING gates which objects may be updated; WITH CHECK stops the row being
-- rewritten to another contractor's folder. Without it, a contractor could
-- move their object under someone else's prefix.
create policy "contractor updates own docs" on storage.objects
  for update to authenticated
  using (bucket_id='contractor-docs'
     and (storage.foldername(name))[1] in
         (select id::text from public.contractors where auth_id = auth.uid()))
  with check (bucket_id='contractor-docs'
     and (storage.foldername(name))[1] in
         (select id::text from public.contractors where auth_id = auth.uid()));

create policy "service role manages docs" on storage.objects
  for all to service_role
  using (bucket_id='contractor-docs') with check (bucket_id='contractor-docs');


-- ============================================================================
-- PART 5 — RLS (rows)
-- ============================================================================

alter table public.contractors         enable row level security;
alter table public.contractor_licenses enable row level security;

-- Explicit per-command policies rather than FOR ALL, so each verb is auditable.
drop policy if exists "lic select own" on public.contractor_licenses;
drop policy if exists "lic insert own" on public.contractor_licenses;
drop policy if exists "lic update own" on public.contractor_licenses;
drop policy if exists "lic delete own" on public.contractor_licenses;
drop policy if exists "lic service"    on public.contractor_licenses;

create policy "lic select own" on public.contractor_licenses
  for select to authenticated
  using (contractor_id in (select id from public.contractors where auth_id = auth.uid()));

create policy "lic insert own" on public.contractor_licenses
  for insert to authenticated
  with check (contractor_id in (select id from public.contractors where auth_id = auth.uid()));

-- USING gates which rows may be updated; WITH CHECK stops re-parenting a row
-- to another contractor.
create policy "lic update own" on public.contractor_licenses
  for update to authenticated
  using      (contractor_id in (select id from public.contractors where auth_id = auth.uid()))
  with check (contractor_id in (select id from public.contractors where auth_id = auth.uid()));

create policy "lic delete own" on public.contractor_licenses
  for delete to authenticated
  using (contractor_id in (select id from public.contractors where auth_id = auth.uid()));

create policy "lic service" on public.contractor_licenses
  for all to service_role using (true) with check (true);


-- ============================================================================
-- PART 6 — COLUMN-LEVEL PRIVILEGES
--
-- RLS restricts WHICH ROWS, never WHICH COLUMNS. With table-wide UPDATE, a
-- contractor passes `auth_id = auth.uid()` and can then write ANY column on
-- their own row — including lead_balance_cents and status — straight through
-- the REST API, with no dashboard involved.
--
-- The allowlist below is taken from the ACTUAL dashboard payloads:
--   persistProfile(), saveNotifications(), insurance document update.
-- scripts/verify-ssp-hardening.js re-derives it from the HTML and fails on
-- any drift, so this list cannot silently go stale.
-- ============================================================================

revoke insert, update, delete on public.contractors         from authenticated, anon;
revoke insert, update, delete on public.contractor_licenses from authenticated, anon;

do $$
declare
  allow_contractors text[] := array[
    'first_name','last_name','company_name','business_description',
    'years_in_business','number_of_employees','phone','website_url','state',
    'service_zips','service_categories','services_detail',
    'num_technicians','num_vehicles','business_hours','scheduling_system',
    'phone_answered_by','payment_methods',
    'insurance_carrier','insurance_policy_number','insurance_expiration',
    'insurance_doc_url',
    'notif_email','notif_sms','notif_digest'
  ];
  -- contractor_id is INSERT-only: a license may be created under the owning
  -- contractor, but never re-parented afterward.
  lic_insert text[] := array[
    'contractor_id','trade_category','license_type','license_state',
    'license_number','expiration_date','document_url','notes'
  ];
  lic_update text[] := array[
    'trade_category','license_type','license_state',
    'license_number','expiration_date','document_url','notes'
  ];
  c text; n int := 0; missing text[] := '{}';
begin
  foreach c in array allow_contractors loop
    if exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='contractors' and column_name=c) then
      execute format('grant update (%I) on public.contractors to authenticated', c);
      n := n+1;
    else missing := missing || c; end if;
  end loop;
  raise notice 'contractors: UPDATE on % columns', n;
  if array_length(missing,1) is not null then
    raise warning 'contractors: allowlisted but MISSING -> %', missing;
  end if;

  n := 0; missing := '{}';
  foreach c in array lic_insert loop
    if exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='contractor_licenses' and column_name=c) then
      execute format('grant insert (%I) on public.contractor_licenses to authenticated', c);
      n := n+1;
    else missing := missing || c; end if;
  end loop;
  raise notice 'contractor_licenses: INSERT on % columns', n;

  n := 0;
  foreach c in array lic_update loop
    if exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='contractor_licenses' and column_name=c) then
      execute format('grant update (%I) on public.contractor_licenses to authenticated', c);
      n := n+1;
    end if;
  end loop;
  raise notice 'contractor_licenses: UPDATE on % columns (contractor_id excluded)', n;

  grant delete on public.contractor_licenses to authenticated;
end $$;

grant all on public.contractors         to service_role;
grant all on public.contractor_licenses to service_role;


-- ============================================================================
-- PART 7 — VERIFICATION RESET TRIGGERS
--
-- Change the evidence, lose the verification — enforced by the database, so it
-- holds no matter what any client sends or omits.
-- ============================================================================

create or replace function public.reset_insurance_verification()
returns trigger language plpgsql as $$
begin
  if new.insurance_carrier       is distinct from old.insurance_carrier
  or new.insurance_policy_number is distinct from old.insurance_policy_number
  or new.insurance_expiration    is distinct from old.insurance_expiration
  or new.insurance_doc_url       is distinct from old.insurance_doc_url then
    new.insurance_verified    := false;
    new.insurance_verified_at := null;
  end if;
  return new;
end; $$;

drop trigger if exists trg_reset_insurance_verification on public.contractors;
create trigger trg_reset_insurance_verification
  before update on public.contractors
  for each row execute function public.reset_insurance_verification();

create or replace function public.reset_license_verification()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'INSERT' then
    new.verified := false; new.verified_at := null; new.verified_by := null;
    return new;
  end if;

  if new.trade_category  is distinct from old.trade_category
  or new.license_type    is distinct from old.license_type
  or new.license_state   is distinct from old.license_state
  or new.license_number  is distinct from old.license_number
  or new.expiration_date is distinct from old.expiration_date
  or new.document_url    is distinct from old.document_url then
    new.verified := false; new.verified_at := null; new.verified_by := null;
  end if;
  return new;
end; $$;

drop trigger if exists trg_reset_license_verification on public.contractor_licenses;
create trigger trg_reset_license_verification
  before insert or update on public.contractor_licenses
  for each row execute function public.reset_license_verification();

-- ADMIN NOTE: these fire for service_role too. To mark something verified,
-- update ONLY the verification columns in that statement. Touching an evidence
-- column in the same statement clears the verdict again.


-- ============================================================================
-- PART 8 — VERIFY. Every can_* must be FALSE; every edit_* must be TRUE.
-- ============================================================================

select
  has_table_privilege('authenticated','public.contractors','UPDATE')                        as table_wide_update,
  has_column_privilege('authenticated','public.contractors','status','UPDATE')              as can_set_status,
  has_column_privilege('authenticated','public.contractors','lead_balance_cents','UPDATE')  as can_set_paid,
  has_column_privilege('authenticated','public.contractors','promo_credits_cents','UPDATE') as can_set_promo,
  has_column_privilege('authenticated','public.contractors','membership_tier','UPDATE')     as can_set_tier,
  has_column_privilege('authenticated','public.contractors','stripe_customer_id','UPDATE')  as can_set_stripe,
  has_column_privilege('authenticated','public.contractors','auth_id','UPDATE')             as can_reassign_auth,
  has_column_privilege('authenticated','public.contractors','insurance_verified','UPDATE')  as can_self_verify,
  has_column_privilege('authenticated','public.contractors','agreement_version','UPDATE')   as can_forge_agreement,
  has_column_privilege('authenticated','public.contractors','deletion_requested_at','UPDATE') as can_set_deletion;

select
  has_column_privilege('authenticated','public.contractors','phone','UPDATE')                   as edit_phone,
  has_column_privilege('authenticated','public.contractors','company_name','UPDATE')            as edit_company,
  has_column_privilege('authenticated','public.contractors','business_hours','UPDATE')          as edit_hours,
  has_column_privilege('authenticated','public.contractors','insurance_policy_number','UPDATE') as edit_policy,
  has_column_privilege('authenticated','public.contractors','service_zips','UPDATE')            as edit_zips,
  has_column_privilege('authenticated','public.contractors','notif_email','UPDATE')             as edit_notifs,
  has_column_privilege('authenticated','public.contractors','insurance_doc_url','UPDATE')       as edit_ins_doc;

select
  has_table_privilege('authenticated','public.contractor_licenses','INSERT')                     as table_wide_insert,
  has_column_privilege('authenticated','public.contractor_licenses','verified','INSERT')         as can_insert_verified,
  has_column_privilege('authenticated','public.contractor_licenses','verified','UPDATE')         as can_update_verified,
  has_column_privilege('authenticated','public.contractor_licenses','verified_at','UPDATE')      as can_set_verified_at,
  has_column_privilege('authenticated','public.contractor_licenses','verified_by','UPDATE')      as can_set_verified_by,
  has_column_privilege('authenticated','public.contractor_licenses','contractor_id','UPDATE')    as can_reparent,
  has_column_privilege('authenticated','public.contractor_licenses','contractor_id','INSERT')    as can_insert_owner,  -- TRUE
  has_column_privilege('authenticated','public.contractor_licenses','license_number','INSERT')   as can_insert_number; -- TRUE

select id, public, file_size_limit, allowed_mime_types
  from storage.buckets where id='contractor-docs';
-- public=false, file_size_limit=10485760, mime types restricted