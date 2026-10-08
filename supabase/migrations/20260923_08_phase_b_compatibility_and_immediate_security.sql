-- LIVE APPLIED 2026-09-23 to Select Service Pros production Supabase.
-- Compatibility columns + immediate read-policy/storage-cap hardening.
-- This is the exact successful migration after the first storage-owner attempt
-- failed atomically on ALTER TABLE storage.objects.

begin;

alter table public.contractors
  add column if not exists agreement_accepted_user_agent text;

alter table public.contractor_licenses
  add column if not exists verified_by text;

alter table public.contractors
  alter column notif_sms set default false;

create index if not exists idx_contractors_auth_id on public.contractors(auth_id);
create index if not exists idx_contractors_status on public.contractors(status);
create index if not exists idx_contractors_active_bal on public.contractors(status) where status='Active';
create index if not exists idx_lic_contractor on public.contractor_licenses(contractor_id);
create index if not exists idx_lic_unverified on public.contractor_licenses(contractor_id) where verified=false;

-- Historical policy was accidentally TO public USING(true), exposing every
-- contractor row to browser roles. Keep service-role visibility only.
drop policy if exists "Service role can read all contractors" on public.contractors;
drop policy if exists "service role reads all contractors" on public.contractors;
create policy "service role reads all contractors" on public.contractors
  for select to service_role using (true);

-- storage.objects is already RLS-enabled and owned by supabase_storage_admin.
-- The management connection cannot ALTER that table; only bucket metadata is
-- changed here. Existing own-folder policies remain until storage-owner policy
-- cleanup is performed through an owner-capable channel.
update storage.buckets
   set public=false,
       file_size_limit=10485760,
       allowed_mime_types=array['application/pdf','image/jpeg','image/png']
 where id='contractor-docs';

create or replace function public.reset_insurance_verification()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.insurance_carrier       is distinct from old.insurance_carrier
  or new.insurance_policy_number is distinct from old.insurance_policy_number
  or new.insurance_expiration    is distinct from old.insurance_expiration
  or new.insurance_doc_url       is distinct from old.insurance_doc_url then
    new.insurance_verified := false;
    new.insurance_verified_at := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_reset_insurance_verification on public.contractors;
create trigger trg_reset_insurance_verification
before update on public.contractors
for each row execute function public.reset_insurance_verification();

create or replace function public.reset_license_verification()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if tg_op='INSERT' then
    new.verified := false;
    new.verified_at := null;
    new.verified_by := null;
    return new;
  end if;
  if new.trade_category  is distinct from old.trade_category
  or new.license_type    is distinct from old.license_type
  or new.license_state   is distinct from old.license_state
  or new.license_number  is distinct from old.license_number
  or new.expiration_date is distinct from old.expiration_date
  or new.document_url    is distinct from old.document_url then
    new.verified := false;
    new.verified_at := null;
    new.verified_by := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_reset_license_verification on public.contractor_licenses;
create trigger trg_reset_license_verification
before insert or update on public.contractor_licenses
for each row execute function public.reset_license_verification();

commit;