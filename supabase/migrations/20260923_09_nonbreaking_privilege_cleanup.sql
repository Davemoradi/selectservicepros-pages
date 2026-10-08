-- LIVE APPLIED 2026-09-23. Safe cleanup that does not depend on the new UI.
begin;
revoke insert, update, delete, truncate, references, trigger on public.contractors from anon;
revoke insert, update, delete, truncate, references, trigger on public.contractor_licenses from anon;
revoke insert, update, delete, truncate, references, trigger on public.leads from anon;
revoke truncate, references, trigger on public.contractors from authenticated;
revoke truncate, references, trigger on public.contractor_licenses from authenticated;
revoke truncate, references, trigger on public.leads from authenticated;
alter function public.csv_has_token(text,text,boolean) set search_path=public;
alter function public.debit_wallet(uuid,integer,uuid,text) set search_path=public;
alter function public.reverse_debit(uuid,text,text) set search_path=public;
alter function public.fill_offer_slots(uuid) set search_path=public;
alter function public.accept_lead(uuid,uuid) set search_path=public;
alter function public.decline_offer(uuid,uuid) set search_path=public;
alter function public.expire_offers() set search_path=public;
commit;