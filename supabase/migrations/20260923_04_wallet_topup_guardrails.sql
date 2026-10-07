-- SSP wallet top-up guardrails + canonical credit_wallet signature.
-- Status: additive / privilege-hardening. No subscriptions.
-- Requires the previously installed wallet core columns on contractors and
-- wallet_transactions. This migration normalizes credit_wallet() to the
-- 8-argument idempotency-key signature used by Stripe and promo grants.

begin;

-- Fail loudly if the wallet core is incomplete.
do $$
begin
  if to_regclass('public.wallet_transactions') is null then
    raise exception 'public.wallet_transactions is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='contractors' and column_name='promo_credits_cents'
  ) then raise exception 'public.contractors.promo_credits_cents is missing'; end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='contractors' and column_name='lead_balance_cents'
  ) then raise exception 'public.contractors.lead_balance_cents is missing'; end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='wallet_transactions' and column_name='promo_delta_cents'
  ) then raise exception 'wallet_transactions.promo_delta_cents is missing'; end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='wallet_transactions' and column_name='paid_delta_cents'
  ) then raise exception 'wallet_transactions.paid_delta_cents is missing'; end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='wallet_transactions' and column_name='paid_balance_after_cents'
  ) then raise exception 'wallet_transactions.paid_balance_after_cents is missing'; end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='wallet_transactions' and column_name='promo_balance_after_cents'
  ) then raise exception 'wallet_transactions.promo_balance_after_cents is missing'; end if;
end $$;

alter table public.wallet_transactions
  add column if not exists idempotency_key text;

create unique index if not exists wallet_tx_idempotency_key_once
  on public.wallet_transactions (idempotency_key)
  where idempotency_key is not null;

create unique index if not exists wallet_tx_topup_stripe_ref
  on public.wallet_transactions (stripe_ref)
  where type = 'topup' and stripe_ref is not null;

-- Retire the pre-idempotency overload so PostgREST/RPC resolution cannot choose
-- an older function by accident. The current canonical signature follows.
drop function if exists public.credit_wallet(uuid,integer,text,text,uuid,text,text);

create or replace function public.credit_wallet(
  p_contractor_id uuid,
  p_amount_cents integer,
  p_type text,
  p_idempotency_key text default null,
  p_stripe_ref text default null,
  p_lead_id uuid default null,
  p_description text default null,
  p_created_by text default null
) returns public.wallet_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_promo_add integer := 0;
  v_paid_add integer := 0;
  v_promo_after integer;
  v_paid_after integer;
  v_row public.wallet_transactions;
begin
  if p_amount_cents <= 0 then
    raise exception 'credit amount must be positive (got %)', p_amount_cents;
  end if;

  if p_type not in ('topup','promo_grant','bonus','adjustment') then
    raise exception 'unsupported wallet credit type %', p_type;
  end if;

  -- Every externally-triggered money credit must have a deterministic key.
  if p_type in ('topup','promo_grant','bonus') and nullif(btrim(p_idempotency_key),'') is null then
    raise exception 'idempotency_key required for credit type %', p_type;
  end if;

  if p_idempotency_key is not null then
    select * into v_row
      from public.wallet_transactions
     where idempotency_key = p_idempotency_key;
    if found then
      -- A key may never be reused for a different contractor/amount/type.
      if v_row.contractor_id <> p_contractor_id
         or v_row.amount_cents <> p_amount_cents
         or v_row.type <> p_type then
        raise exception 'idempotency_key conflict';
      end if;
      return v_row;
    end if;
  end if;

  if p_type = 'promo_grant' then
    v_promo_add := p_amount_cents;
  else
    v_paid_add := p_amount_cents;
  end if;

  update public.contractors
     set promo_credits_cents = promo_credits_cents + v_promo_add,
         lead_balance_cents  = lead_balance_cents  + v_paid_add
   where id = p_contractor_id
   returning promo_credits_cents, lead_balance_cents
        into v_promo_after, v_paid_after;

  if v_paid_after is null then
    raise exception 'contractor % not found', p_contractor_id;
  end if;

  insert into public.wallet_transactions
    (contractor_id, amount_cents, promo_delta_cents, paid_delta_cents,
     type, paid_balance_after_cents, promo_balance_after_cents,
     lead_id, stripe_ref, idempotency_key, description, created_by)
  values
    (p_contractor_id, p_amount_cents, v_promo_add, v_paid_add,
     p_type, v_paid_after, v_promo_after,
     p_lead_id, p_stripe_ref, p_idempotency_key, p_description, p_created_by)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.credit_wallet(uuid,integer,text,text,text,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.credit_wallet(uuid,integer,text,text,text,uuid,text,text)
  to service_role;

-- Stripe customer identity is server-owned. Contractors cannot change it.
revoke update (stripe_customer_id) on public.contractors from authenticated;

commit;

-- Verification: false / false / true and false.
select
  has_function_privilege('anon',
    'public.credit_wallet(uuid,integer,text,text,text,uuid,text,text)','EXECUTE') as anon_can_credit,
  has_function_privilege('authenticated',
    'public.credit_wallet(uuid,integer,text,text,text,uuid,text,text)','EXECUTE') as authenticated_can_credit,
  has_function_privilege('service_role',
    'public.credit_wallet(uuid,integer,text,text,text,uuid,text,text)','EXECUTE') as service_can_credit;

select has_column_privilege(
  'authenticated','public.contractors','stripe_customer_id','UPDATE'
) as contractor_can_change_stripe_customer;