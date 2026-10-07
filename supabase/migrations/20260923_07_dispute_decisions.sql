-- SSP lead dispute decisions + exact wallet reversal.
-- Requires lead_disputes and reverse_debit() from the wallet core migration.

begin;

do $$
begin
  if to_regclass('public.lead_disputes') is null then raise exception 'public.lead_disputes is missing'; end if;
  if to_regprocedure('public.reverse_debit(uuid,text,text)') is null then raise exception 'public.reverse_debit(uuid,text,text) is missing'; end if;
end $$;

drop function if exists public.decide_lead_dispute(uuid,text,text);
create function public.decide_lead_dispute(
  p_dispute_id uuid,
  p_decision text,
  p_decided_by text
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_d public.lead_disputes;
  v_tx public.wallet_transactions;
  v_charge public.wallet_transactions;
begin
  if p_decision not in ('approved','rejected') then raise exception 'invalid decision'; end if;
  if p_decided_by is null or btrim(p_decided_by)='' then raise exception 'decided_by required'; end if;

  select * into v_d from public.lead_disputes where id=p_dispute_id for update;
  if not found then raise exception 'dispute % not found',p_dispute_id; end if;

  if v_d.decision is not null then
    return jsonb_build_object('ok',true,'already',true,'decision',v_d.decision,'dispute_id',v_d.id,'reversal_transaction_id',v_d.reversal_transaction_id);
  end if;

  select * into v_charge from public.wallet_transactions where id=v_d.debit_transaction_id;
  if not found or v_charge.type<>'lead_charge' or v_charge.contractor_id<>v_d.contractor_id or v_charge.lead_id<>v_d.lead_id then
    raise exception 'dispute/debit relationship invalid';
  end if;

  if p_decision='approved' then
    v_tx:=public.reverse_debit(v_d.debit_transaction_id,'Approved SSP lead dispute '||v_d.id::text,p_decided_by);
    update public.lead_disputes set
      decision='approved',decided_at=now(),decided_by=p_decided_by,
      restored_promo_cents=abs(coalesce(v_tx.promo_delta_cents,0)),
      restored_paid_cents=abs(coalesce(v_tx.paid_delta_cents,0)),
      reversal_transaction_id=v_tx.id
    where id=v_d.id;
    return jsonb_build_object('ok',true,'already',false,'decision','approved','dispute_id',v_d.id,'reversal_transaction_id',v_tx.id);
  end if;

  update public.lead_disputes set
    decision='rejected',decided_at=now(),decided_by=p_decided_by,
    restored_promo_cents=0,restored_paid_cents=0
  where id=v_d.id;
  return jsonb_build_object('ok',true,'already',false,'decision','rejected','dispute_id',v_d.id);
end;
$$;

revoke all on function public.decide_lead_dispute(uuid,text,text) from public,anon,authenticated;
grant execute on function public.decide_lead_dispute(uuid,text,text) to service_role;

commit;

select
  has_function_privilege('anon','public.decide_lead_dispute(uuid,text,text)','EXECUTE') as anon_can_decide,
  has_function_privilege('authenticated','public.decide_lead_dispute(uuid,text,text)','EXECUTE') as authenticated_can_decide,
  has_function_privilege('service_role','public.decide_lead_dispute(uuid,text,text)','EXECUTE') as service_can_decide;