-- Standalone water-heater pilot: no modification of SSP lead/payment tables.
create table if not exists public.wh_pilot_quotes (
  id uuid primary key default gen_random_uuid(),
  client_ref uuid not null unique,
  customer_token_hash text not null,
  request_ip_hash text,
  status text not null default 'draft' check (status in ('draft','submitted','reviewing','quoted','scheduled','installed','verified','paid','warranty_closed','declined')),
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  street_address text not null,
  apartment text,
  zip_code text not null,
  property_type text not null,
  location_detail text,
  fuel_type text not null check (fuel_type in ('natural_gas','electric','propane','unsure')),
  capacity_gallons integer check (capacity_gallons between 20 and 120),
  vent_type text not null check (vent_type in ('atmospheric','power','direct','electric_na','unsure')),
  expansion_tank text not null check (expansion_tank in ('yes','no','unsure')),
  tier_preference text not null check (tier_preference in ('essential','plus','premium','unsure')),
  model_number text,
  access_notes text,
  customer_notes text,
  media_paths jsonb not null default '{}'::jsonb,
  quoted_price_cents integer check (quoted_price_cents is null or quoted_price_cents between 10000 and 2000000),
  equipment_cost_cents integer not null default 75000 check (equipment_cost_cents >= 0),
  installation_cost_cents integer not null default 50000 check (installation_cost_cents >= 0),
  additional_cost_cents integer not null default 0 check (additional_cost_cents >= 0),
  installer_company text,
  installer_phone text,
  installer_license text,
  review_notes text,
  scheduled_at timestamptz,
  installed_at timestamptz,
  verified_at timestamptz,
  paid_at timestamptz,
  payout_reference text,
  payout_paid_cents integer check (payout_paid_cents is null or payout_paid_cents >= 0),
  warranty_closes_at timestamptz,
  consent_accepted boolean not null default false,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wh_pilot_quotes_status_created_idx on public.wh_pilot_quotes (status, created_at desc);
create index if not exists wh_pilot_quotes_ip_created_idx on public.wh_pilot_quotes (request_ip_hash, created_at desc);
create table if not exists public.wh_pilot_events (
  id bigint generated always as identity primary key,
  quote_id uuid not null references public.wh_pilot_quotes(id) on delete cascade,
  event_type text not null,
  actor text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists wh_pilot_events_quote_created_idx on public.wh_pilot_events (quote_id, created_at desc);
create table if not exists public.wh_pilot_callbacks (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.wh_pilot_quotes(id) on delete cascade,
  description text not null,
  status text not null default 'open' check (status in ('open','resolved')),
  resolution_note text,
  opened_by text not null,
  resolved_by text,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists wh_pilot_callbacks_quote_created_idx on public.wh_pilot_callbacks (quote_id, opened_at desc);
alter table public.wh_pilot_quotes enable row level security;
alter table public.wh_pilot_events enable row level security;
alter table public.wh_pilot_callbacks enable row level security;
revoke all on public.wh_pilot_quotes from anon, authenticated;
revoke all on public.wh_pilot_events from anon, authenticated;
revoke all on public.wh_pilot_callbacks from anon, authenticated;
grant all on public.wh_pilot_quotes to service_role;
grant all on public.wh_pilot_events to service_role;
grant all on public.wh_pilot_callbacks to service_role;
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('wh-pilot-private','wh-pilot-private',false,45000000,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/quicktime','video/webm']::text[])
on conflict (id) do nothing;