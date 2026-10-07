-- ============================================================================
-- 20260916_02_notification_outbox.sql
-- Durable notification outbox + DB-level event emission.
--
-- WHY AN OUTBOX
--   Direct webhook calls from request handlers lose events whenever the remote
--   is slow or down, and they double-fire on retry. Worse, they only cover the
--   code path that remembers to call them: a lead offer created by the cron
--   refill would never notify, because only the decline handler had the call.
--
--   Emitting at the DATABASE level means every creation path is covered
--   automatically — original matching, decline/refill, and future cron alike.
--
-- NOT EXECUTED.
-- ============================================================================


-- ============================================================================
-- PART 1 — the outbox
-- ============================================================================

create table if not exists public.notification_outbox (
  id               uuid primary key default gen_random_uuid(),
  event_type       text        not null,
  event_version    int         not null default 1,
  contractor_id    uuid        references public.contractors(id) on delete set null,
  lead_id          uuid        references public.leads(id)       on delete set null,
  offer_id         uuid        references public.lead_offers(id) on delete set null,
  payload          jsonb       not null default '{}'::jsonb,
  idempotency_key  text        not null unique,
  status           text        not null default 'pending'
                   check (status in ('pending','processing','retry','sent','obsolete','dead')),
  attempt_count    int         not null default 0,
  next_attempt_at  timestamptz not null default now(),
  locked_at        timestamptz,
  locked_by        text,
  sent_at          timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),

  constraint outbox_sent_has_time check (status <> 'sent' or sent_at is not null),
  constraint outbox_attempts_sane check (attempt_count >= 0 and attempt_count <= 50),
  constraint outbox_error_bounded check (last_error is null or length(last_error) <= 2000)
);

-- Worker claim path: cheapest possible index for "what is due".
create index if not exists idx_outbox_claim
  on public.notification_outbox (next_attempt_at)
  where status in ('pending','retry');

create index if not exists idx_outbox_stale_lease
  on public.notification_outbox (locked_at)
  where status = 'processing';

create index if not exists idx_outbox_offer on public.notification_outbox (offer_id);
create index if not exists idx_outbox_lead  on public.notification_outbox (lead_id);
create index if not exists idx_outbox_type  on public.notification_outbox (event_type, created_at desc);

comment on table public.notification_outbox is
  'Durable event queue consumed by api/process-notifications.js. Service-role only. Contractor-facing pre-accept events must contain NO homeowner PII; internal homeowner lifecycle events may contain the minimum PII required for communication.';
comment on column public.notification_outbox.idempotency_key is
  'Deterministic. One-time events use <type>:v<n>:<entity_id>. Repeatable lifecycle transitions append a per-transition nonce so a later legitimate transition is not permanently blocked.';

-- Browser roles get nothing. Not even SELECT: payloads carry contractor
-- contact data and, post-accept, homeowner PII.
revoke all on public.notification_outbox from anon, authenticated;
grant all on public.notification_outbox to service_role;

alter table public.notification_outbox enable row level security;
drop policy if exists "outbox service only" on public.notification_outbox;
create policy "outbox service only" on public.notification_outbox
  for all to service_role using (true) with check (true);


-- ============================================================================
-- PART 2 — emit helper
-- ============================================================================

create or replace function public.enqueue_notification(
  p_event_type      text,
  p_idempotency_key text,
  p_payload         jsonb   default '{}'::jsonb,
  p_contractor_id   uuid    default null,
  p_lead_id         uuid    default null,
  p_offer_id        uuid    default null,
  p_event_version   int     default 1,
  p_delay           interval default interval '0'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.notification_outbox
    (event_type, event_version, contractor_id, lead_id, offer_id,
     payload, idempotency_key, next_attempt_at)
  values
    (p_event_type, p_event_version, p_contractor_id, p_lead_id, p_offer_id,
     p_payload, p_idempotency_key, now() + p_delay)
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  return v_id;   -- null when already enqueued
end; $$;

-- CRITICAL: Postgres grants EXECUTE to PUBLIC by default. Revoking anon and
-- authenticated leaves PUBLIC intact, and both roles inherit it — so the
-- function stays callable. PUBLIC must be revoked explicitly and FIRST.
--
-- enqueue_notification is SECURITY DEFINER. Reachable by a browser role it
-- would let any signed-in user inject arbitrary outbound events: fake
-- approvals, fake lead offers, forged payloads to the GHL webhook.
revoke all on function public.enqueue_notification(text,text,jsonb,uuid,uuid,uuid,int,interval)
  from public, anon, authenticated;
grant execute on function public.enqueue_notification(text,text,jsonb,uuid,uuid,uuid,int,interval)
  to service_role;


-- ============================================================================
-- PART 3 — claim RPC
--
-- FOR UPDATE SKIP LOCKED is what makes two concurrent workers safe: each
-- skips rows the other has locked instead of blocking on them.
-- ============================================================================

create or replace function public.claim_notifications(
  p_worker text,
  p_limit  int default 10,
  p_lease  interval default interval '5 minutes'
) returns setof public.notification_outbox
language plpgsql security definer set search_path = public as $$
begin
  -- Reclaim leases from workers that died mid-flight.
  update public.notification_outbox
     set status = 'retry', locked_at = null, locked_by = null
   where status = 'processing'
     and locked_at < now() - p_lease;

  return query
  with due as (
    select id from public.notification_outbox
     where status in ('pending','retry')
       and next_attempt_at <= now()
     order by next_attempt_at
     limit p_limit
     for update skip locked
  )
  update public.notification_outbox o
     set status = 'processing',
         locked_at = now(),
         locked_by = p_worker,
         attempt_count = o.attempt_count + 1
    from due
   where o.id = due.id
  returning o.*;
end; $$;

-- Same PUBLIC problem. claim_notifications mutates queue state and returns
-- payloads containing homeowner PII.
revoke all on function public.claim_notifications(text,int,interval)
  from public, anon, authenticated;
grant execute on function public.claim_notifications(text,int,interval)
  to service_role;


-- ============================================================================
-- PART 3b — LEASE-CONDITIONED SETTLE
--
-- A worker whose lease expired may still be running. Without conditioning the
-- settle on its own lease, that zombie can mark `sent` a job another worker
-- has since reclaimed and is actively processing — losing or duplicating it.
-- Every settle must prove it still owns the row.
-- ============================================================================

create or replace function public.settle_notification(
  p_id        uuid,
  p_worker    text,
  p_status    text,
  p_error     text default null,
  p_next_at   timestamptz default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  if p_status not in ('sent','retry','dead','obsolete') then
    raise exception 'invalid settle status %', p_status;
  end if;

  update public.notification_outbox
     set status    = p_status,
         sent_at   = case when p_status='sent' then now() else sent_at end,
         last_error= left(p_error, 2000),
         next_attempt_at = coalesce(p_next_at, next_attempt_at),
         locked_at = null,
         locked_by = null
   where id = p_id
     and locked_by = p_worker        -- still ours
     and status = 'processing';      -- not already reclaimed
  get diagnostics v_rows = row_count;
  return v_rows > 0;                 -- false = lease lost, do not retry blindly
end; $$;

revoke all on function public.settle_notification(uuid,text,text,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.settle_notification(uuid,text,text,text,timestamptz)
  to service_role;


-- ============================================================================
-- PART 4 — EVENT TRIGGERS
--
-- PRE-ACCEPT PRIVACY: lead_offer_created carries structured fields only —
-- category, issue, urgency, ZIP, price, expiry. No homeowner name, phone,
-- email, street address, or free-text description. Those appear only after a
-- committed debit, in lead_accepted.
-- ============================================================================

-- 4a. contractor_created
create or replace function public.emit_contractor_created()
returns trigger language plpgsql as $$
begin
  perform public.enqueue_notification(
    'contractor_created',
    'contractor_created:v1:' || new.id::text,
    jsonb_build_object(
      'contractor_id', new.id,
      'email',         new.email,
      'first_name',    new.first_name,
      'last_name',     new.last_name,
      'company_name',  new.company_name,
      'phone',         new.phone,
      'status',        new.status
    ),
    new.id, null, null);
  return new;
end; $$;

drop trigger if exists trg_emit_contractor_created on public.contractors;
create trigger trg_emit_contractor_created
  after insert on public.contractors
  for each row execute function public.emit_contractor_created();


-- 4b. contractor lifecycle transitions
-- These can legitimately recur (Active -> Suspended -> Active), so the key
-- includes the transition timestamp. A permanent key would silently swallow
-- every future reinstatement.
create or replace function public.emit_contractor_status_event()
returns trigger language plpgsql as $$
declare v_type text;
begin
  if new.status is not distinct from old.status then return new; end if;

  v_type := case new.status
    when 'Pending Review'      then 'contractor_submitted_for_review'
    when 'Active'              then 'contractor_approved'
    when 'Rejected'            then 'contractor_rejected'
    when 'Suspended'           then 'contractor_suspended'
    when 'Deletion Requested'  then 'contractor_deletion_requested'
    else null end;
  if v_type is null then return new; end if;

  perform public.enqueue_notification(
    v_type,
      -- Lifecycle transitions may legitimately recur. A random transition nonce
    -- makes each actual DB transition unique without permanently suppressing
    -- a later reinstatement/review cycle. Retries do not create another row
    -- because the trigger only fires on another real status change.
    v_type || ':v1:' || new.id::text || ':' || gen_random_uuid()::text,
    jsonb_build_object(
      'contractor_id',  new.id,
      'email',          new.email,
      'first_name',     new.first_name,
      'last_name',      new.last_name,
      'company_name',   new.company_name,
      'phone',          new.phone,
      'previous_status',old.status,
      'status',         new.status
    ),
    new.id, null, null);
  return new;
end; $$;

drop trigger if exists trg_emit_contractor_status on public.contractors;
create trigger trg_emit_contractor_status
  after update of status on public.contractors
  for each row execute function public.emit_contractor_status_event();


-- 4c. lead_submitted — final homeowner submission, whether inserted directly or
-- finalized from a Partial row. This is an INTERNAL SSP CRM event, not a
-- contractor-facing offer, so minimum homeowner contact data is permitted.
create or replace function public.emit_lead_submitted()
returns trigger language plpgsql as $$
begin
  if coalesce(new.partial, false) then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.partial, false) = false then return new; end if;

  perform public.enqueue_notification(
    'lead_submitted',
    'lead_submitted:v1:' || new.id::text,
    jsonb_build_object(
      'lead_id',          new.id,
      'homeowner_name',   new.homeowner_name,
      'homeowner_email',  new.homeowner_email,
      'homeowner_phone',  new.homeowner_phone,
      'homeowner_zip',    new.homeowner_zip,
      'homeowner_city',   new.homeowner_city,
      'homeowner_state',  new.homeowner_state,
      'service_category', new.service_category,
      'service_type',     new.service_type,
      'issue_code',       new.issue_code,
      'urgency',          new.urgency,
      'status',           new.status
    ),
    null, new.id, null);
  return new;
end; $$;

drop trigger if exists trg_emit_lead_submitted_insert on public.leads;
create trigger trg_emit_lead_submitted_insert
  after insert on public.leads
  for each row execute function public.emit_lead_submitted();

drop trigger if exists trg_emit_lead_submitted_finalize on public.leads;
create trigger trg_emit_lead_submitted_finalize
  after update of partial on public.leads
  for each row execute function public.emit_lead_submitted();


-- 4d. lead_offer_created — fires for EVERY creation path
create or replace function public.emit_lead_offer_created()
returns trigger language plpgsql as $$
declare l public.leads%rowtype; c public.contractors%rowtype;
begin
  select * into l from public.leads       where id = new.lead_id;
  select * into c from public.contractors where id = new.contractor_id;

  perform public.enqueue_notification(
    'lead_offer_created',
    'lead_offer_created:v1:' || new.id::text,
    jsonb_build_object(
      'offer_id',        new.id,
      'lead_id',         new.lead_id,
      'contractor_id',   new.contractor_id,
      -- contractor contact: needed to deliver the notification
      'contractor_email',  c.email,
      'contractor_phone',  c.phone,
      'contractor_first_name', c.first_name,
      'notif_email',     coalesce(c.notif_email, true),
      'notif_sms',       coalesce(c.notif_sms,  false),
      -- STRUCTURED, NON-PII lead fields only
      'service_category', l.service_category,
      'service_type',     l.service_type,
      'issue_code',       l.issue_code,
      'urgency',          l.urgency,
      'zip',              l.homeowner_zip,
      'price_cents',      new.price_cents,
      'expires_at',       new.expires_at,
      'deep_link', 'https://www.selectservicepros.com/contractor-dashboard.html?tab=leads&lead='
                   || new.lead_id::text || '&action=accept'
    ),
    new.contractor_id, new.lead_id, new.id);
  return new;
end; $$;

drop trigger if exists trg_emit_lead_offer_created on public.lead_offers;
create trigger trg_emit_lead_offer_created
  after insert on public.lead_offers
  for each row execute function public.emit_lead_offer_created();


-- 4e. lead_accepted — post-debit, so homeowner PII is permitted here
create or replace function public.emit_lead_accepted()
returns trigger language plpgsql as $$
declare l public.leads%rowtype; c public.contractors%rowtype;
begin
  if new.status <> 'accepted' or old.status = 'accepted' then return new; end if;

  select * into l from public.leads       where id = new.lead_id;
  select * into c from public.contractors where id = new.contractor_id;

  perform public.enqueue_notification(
    'lead_accepted',
    'lead_accepted:v1:' || new.id::text,
    jsonb_build_object(
      'offer_id',      new.id,
      'lead_id',       new.lead_id,
      'contractor_id', new.contractor_id,
      'transaction_id',new.transaction_id,
      'price_cents',   new.price_cents,
      'accepted_at',   new.responded_at,
      'contractor_first_name', c.first_name,
      'contractor_last_name',  c.last_name,
      'contractor_company',    c.company_name,
      'contractor_phone',      c.phone,
      'contractor_email',      c.email,
      -- PII: released only because the debit has committed
      'homeowner_name',    l.homeowner_name,
      'homeowner_email',   l.homeowner_email,
      'homeowner_phone',   l.homeowner_phone,
      'homeowner_address', l.homeowner_address,
      'homeowner_zip',     l.homeowner_zip,
      'service_category',  l.service_category,
      'service_type',      l.service_type,
      'urgency',           l.urgency
    ),
    new.contractor_id, new.lead_id, new.id);
  return new;
end; $$;

drop trigger if exists trg_emit_lead_accepted on public.lead_offers;
create trigger trg_emit_lead_accepted
  after update of status on public.lead_offers
  for each row execute function public.emit_lead_accepted();


-- 4f. lead_unmatched
create or replace function public.emit_lead_unmatched()
returns trigger language plpgsql as $$
begin
  if new.status <> 'Unmatched' or old.status = 'Unmatched' then return new; end if;

  perform public.enqueue_notification(
    'lead_unmatched',
    'lead_unmatched:v1:' || new.id::text,
    jsonb_build_object(
      'lead_id',          new.id,
      'service_category', new.service_category,
      'service_type',     new.service_type,
      'zip',              new.homeowner_zip,
      'price_cents',      new.price_cents,
      'homeowner_email',  new.homeowner_email,   -- SSP apologises to the homeowner
      'homeowner_name',   new.homeowner_name
    ),
    null, new.id, null);
  return new;
end; $$;

drop trigger if exists trg_emit_lead_unmatched on public.leads;
create trigger trg_emit_lead_unmatched
  after update of status on public.leads
  for each row execute function public.emit_lead_unmatched();


-- ============================================================================
-- PART 5 — VERIFY
-- ============================================================================

-- select tgname, tgrelid::regclass from pg_trigger
--  where tgname like 'trg_emit_%' order by tgname;   -- expect 7 (2 lead_submitted triggers)
--
-- SECURITY DEFINER execute privileges — every one must be FALSE:
-- select
--   has_function_privilege('anon','public.enqueue_notification(text,text,jsonb,uuid,uuid,uuid,int,interval)','EXECUTE')          as anon_enqueue,
--   has_function_privilege('authenticated','public.enqueue_notification(text,text,jsonb,uuid,uuid,uuid,int,interval)','EXECUTE') as auth_enqueue,
--   has_function_privilege('anon','public.claim_notifications(text,int,interval)','EXECUTE')                                     as anon_claim,
--   has_function_privilege('authenticated','public.claim_notifications(text,int,interval)','EXECUTE')                            as auth_claim,
--   has_function_privilege('anon','public.settle_notification(uuid,text,text,text,timestamptz)','EXECUTE')                       as anon_settle,
--   has_function_privilege('authenticated','public.settle_notification(uuid,text,text,text,timestamptz)','EXECUTE')              as auth_settle;
-- And these must be TRUE:
-- select
--   has_function_privilege('service_role','public.enqueue_notification(text,text,jsonb,uuid,uuid,uuid,int,interval)','EXECUTE') as svc_enqueue,
--   has_function_privilege('service_role','public.claim_notifications(text,int,interval)','EXECUTE')                            as svc_claim;
--
-- select has_table_privilege('authenticated','public.notification_outbox','SELECT') as browser_read; -- false
-- select has_table_privilege('anon','public.notification_outbox','SELECT')          as anon_read;    -- false
--
-- Pre-accept PII leak check — must return 0:
-- select count(*) from public.notification_outbox
--  where event_type = 'lead_offer_created'
--    and (payload ? 'homeowner_name' or payload ? 'homeowner_phone'
--      or payload ? 'homeowner_email' or payload ? 'homeowner_address'
--      or payload ? 'description');