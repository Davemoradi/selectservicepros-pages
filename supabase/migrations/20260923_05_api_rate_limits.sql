-- SSP durable API rate limiting for public signup and homeowner intake.
-- Fixed-window counters live in Postgres so all Vercel instances share state.
-- Raw IP addresses, emails and phone numbers are never stored; the server sends
-- HMAC-SHA256 keys using RATE_LIMIT_SECRET.

begin;

create table if not exists public.api_rate_limits (
  scope        text        not null,
  key_hash     text        not null,
  window_start timestamptz not null,
  hit_count    integer     not null default 0 check (hit_count >= 0),
  updated_at   timestamptz not null default now(),
  primary key (scope, key_hash, window_start),
  constraint api_rate_limit_scope_len check (char_length(scope) between 1 and 80),
  constraint api_rate_limit_hash_shape check (key_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists idx_api_rate_limits_window
  on public.api_rate_limits (window_start);

alter table public.api_rate_limits enable row level security;
revoke all on public.api_rate_limits from public, anon, authenticated;
grant all on public.api_rate_limits to service_role;

drop function if exists public.consume_api_rate_limit(text,text,integer,integer);
create function public.consume_api_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
) returns table (
  allowed boolean,
  current_count integer,
  reset_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_scope is null or char_length(p_scope) not between 1 and 80 then
    raise exception 'invalid rate-limit scope';
  end if;
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid rate-limit key';
  end if;
  if p_limit < 1 or p_limit > 10000 then
    raise exception 'invalid rate-limit limit';
  end if;
  if p_window_seconds < 10 or p_window_seconds > 86400 then
    raise exception 'invalid rate-limit window';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.api_rate_limits(scope, key_hash, window_start, hit_count, updated_at)
  values (p_scope, p_key_hash, v_window_start, 1, now())
  on conflict (scope, key_hash, window_start)
  do update set
    hit_count = public.api_rate_limits.hit_count + 1,
    updated_at = now()
  returning hit_count into v_count;

  allowed := v_count <= p_limit;
  current_count := v_count;
  reset_at := v_window_start + make_interval(secs => p_window_seconds);
  return next;
end;
$$;

revoke all on function public.consume_api_rate_limit(text,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text,text,integer,integer)
  to service_role;

comment on table public.api_rate_limits is
  'Shared fixed-window counters for SSP public API abuse controls. Keys are server-side HMACs; raw identifiers are not stored.';

commit;

-- Expected: false / false / true, and browser roles cannot read the counter table.
select
  has_function_privilege('anon','public.consume_api_rate_limit(text,text,integer,integer)','EXECUTE') as anon_can_consume,
  has_function_privilege('authenticated','public.consume_api_rate_limit(text,text,integer,integer)','EXECUTE') as authenticated_can_consume,
  has_function_privilege('service_role','public.consume_api_rate_limit(text,text,integer,integer)','EXECUTE') as service_can_consume,
  has_table_privilege('anon','public.api_rate_limits','SELECT') as anon_can_read,
  has_table_privilege('authenticated','public.api_rate_limits','SELECT') as authenticated_can_read;