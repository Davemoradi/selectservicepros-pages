-- LIVE APPLIED 2026-09-23.
-- Interim production protection while the legacy dashboard is still deployed.
-- It closes self-funding, self-activation, Stripe identity, and verification
-- escalation without breaking the legacy profile/agreement/deletion flows.

begin;
create or replace function public.guard_contractor_privileged_fields()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
begin
  if auth.role() = 'authenticated' then
    if new.lead_balance_cents is distinct from old.lead_balance_cents
       or new.promo_credits_cents is distinct from old.promo_credits_cents
       or new.auth_id is distinct from old.auth_id
       or new.membership_tier is distinct from old.membership_tier
       or new.stripe_customer_id is distinct from old.stripe_customer_id
       or new.stripe_subscription_id is distinct from old.stripe_subscription_id
       or new.activated_at is distinct from old.activated_at then
      raise exception 'privileged contractor field';
    end if;

    if new.insurance_verified is distinct from old.insurance_verified
       and coalesce(new.insurance_verified,false) = true then
      raise exception 'insurance verification is admin-controlled';
    end if;
    if new.insurance_verified_at is distinct from old.insurance_verified_at then
      raise exception 'insurance verification timestamp is admin-controlled';
    end if;

    if new.license_verified is distinct from old.license_verified
       and coalesce(new.license_verified,false) = true then
      raise exception 'license verification is admin-controlled';
    end if;

    if new.status is distinct from old.status
       and new.status not in ('Pending Review','Deletion Requested','Deleted') then
      raise exception 'contractor status transition is server-controlled';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_contractor_privileged_fields on public.contractors;
create trigger trg_guard_contractor_privileged_fields
before update on public.contractors
for each row execute function public.guard_contractor_privileged_fields();

create or replace function public.guard_license_admin_fields()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
begin
  if auth.role() = 'authenticated' then
    if coalesce(new.verified,false)=true and coalesce(old.verified,false)=false then
      raise exception 'license verification is admin-controlled';
    end if;
    if new.verified_at is distinct from old.verified_at and new.verified_at is not null then
      raise exception 'license verification timestamp is admin-controlled';
    end if;
    if new.verified_by is distinct from old.verified_by and new.verified_by is not null then
      raise exception 'license verifier is admin-controlled';
    end if;
    if new.contractor_id is distinct from old.contractor_id then
      raise exception 'license ownership cannot be changed';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_license_admin_fields on public.contractor_licenses;
create trigger trg_guard_license_admin_fields
before update on public.contractor_licenses
for each row execute function public.guard_license_admin_fields();
commit;