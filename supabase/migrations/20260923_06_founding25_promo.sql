-- SSP contractor activation readiness + Founding 25 promotional lead credit.
-- - activation requires current insurance verification
-- - HVAC/Plumbing/Electrical selections require a current verified license row
-- - Founding 25 is globally capped at 25 unique promo grants
-- - each contractor can receive the $250 promo at most once

begin;

drop function if exists public.contractor_activation_readiness(uuid);
create function public.contractor_activation_readiness(p_contractor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.contractors%rowtype;
  v_missing text[] := array[]::text[];
  v_trade text;
begin
  select * into v_c from public.contractors where id = p_contractor_id;
  if not found then
    return jsonb_build_object('ready',false,'reason','contractor_not_found');
  end if;

  if coalesce(v_c.insurance_verified,false) is not true then
    return jsonb_build_object('ready',false,'reason','insurance_not_verified');
  end if;
  if v_c.insurance_expiration is null or v_c.insurance_expiration < current_date then
    return jsonb_build_object('ready',false,'reason','insurance_expired_or_missing');
  end if;

  for v_trade in
    select distinct btrim(x)
      from regexp_split_to_table(coalesce(v_c.service_categories,''), ',') as x
     where lower(btrim(x)) in ('hvac','plumbing','electrical')
  loop
    if not exists (
      select 1
        from public.contractor_licenses l
       where l.contractor_id = p_contractor_id
         and lower(btrim(l.trade_category)) = lower(v_trade)
         and l.verified is true
         and (l.expiration_date is null or l.expiration_date >= current_date)
    ) then
      v_missing := array_append(v_missing, v_trade);
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    return jsonb_build_object('ready',false,'reason','required_license_not_verified','missing_trades',to_jsonb(v_missing));
  end if;

  return jsonb_build_object('ready',true,'reason','ready');
end;
$$;

revoke all on function public.contractor_activation_readiness(uuid)
  from public, anon, authenticated;
grant execute on function public.contractor_activation_readiness(uuid)
  to service_role;


drop function if exists public.activate_contractor(uuid);
create function public.activate_contractor(p_contractor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_ready jsonb;
begin
  select status into v_status
    from public.contractors
   where id = p_contractor_id
   for update;
  if not found then raise exception 'contractor % not found', p_contractor_id; end if;

  v_ready := public.contractor_activation_readiness(p_contractor_id);
  if coalesce((v_ready->>'ready')::boolean,false) is not true then
    raise exception 'activation_not_ready:%', coalesce(v_ready->>'reason','unknown');
  end if;

  if v_status <> 'Active' then
    update public.contractors
       set status = 'Active', activated_at = coalesce(activated_at, now())
     where id = p_contractor_id;
  end if;

  return jsonb_build_object('ok',true,'contractor_id',p_contractor_id,'status','Active','already',v_status='Active');
end;
$$;

revoke all on function public.activate_contractor(uuid)
  from public, anon, authenticated;
grant execute on function public.activate_contractor(uuid)
  to service_role;


drop function if exists public.grant_founding25_promo(uuid);
create function public.grant_founding25_promo(p_contractor_id uuid)
returns public.wallet_transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := 'founding25:v1:' || p_contractor_id::text;
  v_existing public.wallet_transactions;
  v_count integer;
  v_row public.wallet_transactions;
begin
  -- Serializes first-25 allocation across different contractors.
  perform pg_advisory_xact_lock(hashtext('ssp_founding25_v1'));

  select * into v_existing
    from public.wallet_transactions
   where idempotency_key = v_key;
  if found then return v_existing; end if;

  select count(*) into v_count
    from public.wallet_transactions
   where type = 'promo_grant'
     and idempotency_key like 'founding25:v1:%';
  if v_count >= 25 then
    raise exception 'founding25_full';
  end if;

  v_row := public.credit_wallet(
    p_contractor_id,
    25000,
    'promo_grant',
    v_key,
    null,
    null,
    'Founding 25 SSP promotional lead credit',
    'admin_founding25'
  );
  return v_row;
end;
$$;

revoke all on function public.grant_founding25_promo(uuid)
  from public, anon, authenticated;
grant execute on function public.grant_founding25_promo(uuid)
  to service_role;


drop function if exists public.approve_founding25_contractor(uuid);
create function public.approve_founding25_contractor(p_contractor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activation jsonb;
  v_tx public.wallet_transactions;
begin
  -- activate_contractor locks/validates credentials. If promo grant fails (for
  -- example because all 25 slots are allocated), the entire outer transaction
  -- rolls back and the contractor is not left Active by a failed approval.
  v_activation := public.activate_contractor(p_contractor_id);
  v_tx := public.grant_founding25_promo(p_contractor_id);

  return jsonb_build_object(
    'ok', true,
    'contractor_id', p_contractor_id,
    'status', 'Active',
    'transaction_id', v_tx.id
  );
end;
$$;

revoke all on function public.approve_founding25_contractor(uuid)
  from public, anon, authenticated;
grant execute on function public.approve_founding25_contractor(uuid)
  to service_role;

commit;

-- Verification: browser roles false, service role true.
select
  has_function_privilege('anon','public.contractor_activation_readiness(uuid)','EXECUTE') as anon_can_read_readiness,
  has_function_privilege('authenticated','public.contractor_activation_readiness(uuid)','EXECUTE') as authenticated_can_read_readiness,
  has_function_privilege('service_role','public.contractor_activation_readiness(uuid)','EXECUTE') as service_can_read_readiness,
  has_function_privilege('anon','public.activate_contractor(uuid)','EXECUTE') as anon_can_activate,
  has_function_privilege('authenticated','public.activate_contractor(uuid)','EXECUTE') as authenticated_can_activate,
  has_function_privilege('service_role','public.activate_contractor(uuid)','EXECUTE') as service_can_activate,
  has_function_privilege('anon','public.grant_founding25_promo(uuid)','EXECUTE') as anon_can_grant,
  has_function_privilege('authenticated','public.grant_founding25_promo(uuid)','EXECUTE') as authenticated_can_grant,
  has_function_privilege('service_role','public.grant_founding25_promo(uuid)','EXECUTE') as service_can_grant;