-- ROOT-WEB-DDGS-02: preserve Tavily history; record DDGS without invented API metadata.
alter table private.web_search_attempts add column provider text not null default 'TAVILY'
 constraint web_search_provider check(provider in ('TAVILY','DDGS'));
alter table private.web_search_attempts drop constraint web_search_observation;
alter table private.web_search_attempts add constraint web_search_observation check (
 (observation='UNKNOWN' and http_status is null and provider_request_id is null and credits is null)
 or (observation='SUCCESS' and (
  (provider='TAVILY' and http_status is not null and http_status=200 and provider_request_id is not null and credits is not null and credits=1)
  or (provider='DDGS' and http_status is null and provider_request_id is null and credits is null)))
 or (observation='ERROR' and provider_request_id is null and credits is null and (provider='TAVILY' or http_status is null))
);
create index web_search_ddgs_spacing on private.web_search_attempts(reserved_at desc) where provider='DDGS';
create function private.guard_ddgs_search_spacing() returns trigger
 language plpgsql security invoker set search_path='' as $$
begin
 if new.provider='DDGS' then
  perform pg_advisory_xact_lock(hashtextextended('web-search-quota:v1',0));
  if exists(select 1 from private.web_search_attempts where provider='DDGS' and reserved_at>clock_timestamp()-interval '10 seconds') then
   raise exception using errcode='P0001',message='WEB_SEARCH_RATE_LIMITED';
  end if;
 end if;
 return new;
end $$;
create trigger web_search_provider_spacing before insert on private.web_search_attempts
 for each row execute function private.guard_ddgs_search_spacing();
revoke all on function private.guard_ddgs_search_spacing() from public,anon,authenticated,service_role;
grant execute on function private.guard_ddgs_search_spacing() to service_role;
-- Existing invoker trigger compares all base columns, including provider; no UPDATE grant added.
