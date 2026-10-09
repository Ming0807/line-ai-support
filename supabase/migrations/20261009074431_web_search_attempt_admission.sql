-- ADV-05C-2-R: retained private admissions; network work occurs after commit.
create table private.web_search_attempts (
 request_key text primary key check (request_key ~ '^[0-9a-f]{64}$'),
 attempt_id uuid not null unique default gen_random_uuid(),
 owner_digest text not null check (owner_digest ~ '^[0-9a-f]{64}$'),
 consumer text not null check (consumer in ('STUDENT','STAFF')),
 purpose text not null check (purpose in ('YRU_INFORMATION','GENERAL_PUBLIC')),
 topic text not null,
 academic_year integer,
 reserved_at timestamptz not null default clock_timestamp(),
 quota_day date not null default (clock_timestamp() at time zone 'UTC')::date,
 quota_month date not null default date_trunc('month',clock_timestamp() at time zone 'UTC')::date,
 observation text not null default 'UNKNOWN',
 http_status integer check (http_status between 100 and 599),
 provider_request_id uuid,
 credits integer check (credits = 1),
 constraint web_search_closed_topic check (
  (purpose='YRU_INFORMATION' and topic in ('ACADEMIC_CALENDAR','CREDIT_TRANSFER','TUITION_FEES','REGISTRATION','WIFI_ACCESS','LIBRARY_SERVICES','STUDENT_ACTIVITIES','DORMITORY'))
  or (purpose='GENERAL_PUBLIC' and topic in ('GENERAL_WIFI_HELP','GENERAL_HTTP_500','GENERAL_DEVICE_NETWORK'))),
 constraint web_search_closed_year check (academic_year is null or
  (topic in ('ACADEMIC_CALENDAR','CREDIT_TRANSFER','TUITION_FEES','REGISTRATION','STUDENT_ACTIVITIES','DORMITORY') and academic_year between 2400 and 3000)),
 constraint web_search_observation check (
  (observation='UNKNOWN' and http_status is null and provider_request_id is null and credits is null)
  or (observation='SUCCESS' and http_status is not null and http_status=200 and provider_request_id is not null and credits is not null and credits=1)
  or (observation='ERROR' and provider_request_id is null and credits is null))
);
alter table private.web_search_attempts enable row level security;
create index web_search_attempts_day on private.web_search_attempts(quota_day);
create index web_search_attempts_month on private.web_search_attempts(quota_month);

create function private.guard_web_search_attempt() returns trigger
 language plpgsql security invoker set search_path='' as $$
declare stamp timestamptz;
begin
 if TG_OP='INSERT' then
  -- Fresh statement snapshots after waiting for the global lock are required.
  if current_setting('transaction_isolation') <> 'read committed' then
   raise exception using errcode='P0001',message='WEB_SEARCH_ADMISSION_UNAVAILABLE';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('web-search-quota:v1',0));
  stamp := clock_timestamp();
  new.reserved_at := stamp;
  new.quota_day := (stamp at time zone 'UTC')::date;
  new.quota_month := date_trunc('month',stamp at time zone 'UTC')::date;
  if new.observation <> 'UNKNOWN' or new.http_status is not null or new.provider_request_id is not null or new.credits is not null then
   raise exception using errcode='P0001',message='WEB_SEARCH_ATTEMPT_IMMUTABLE';
  end if;
  if (select count(*) from private.web_search_attempts where quota_day=new.quota_day)>=50
   or (select count(*) from private.web_search_attempts where quota_month=new.quota_month)>=500 then
   raise exception using errcode='P0001',message='WEB_SEARCH_QUOTA_EXHAUSTED';
  end if;
  return new;
 elsif TG_OP='UPDATE' then
  if (to_jsonb(new)-array['observation','http_status','provider_request_id','credits'])
   is distinct from (to_jsonb(old)-array['observation','http_status','provider_request_id','credits'])
   or old.observation <> 'UNKNOWN' or new.observation not in ('SUCCESS','ERROR') then
   raise exception using errcode='P0001',message='WEB_SEARCH_ATTEMPT_IMMUTABLE';
  end if;
  return new;
 end if;
 raise exception using errcode='P0001',message='WEB_SEARCH_ATTEMPT_IMMUTABLE';
end $$;
create trigger web_search_attempt_admission before insert or update on private.web_search_attempts
 for each row execute function private.guard_web_search_attempt();
create trigger web_search_attempt_retention before delete or truncate on private.web_search_attempts
 for each statement execute function private.guard_web_search_attempt();

revoke all on private.web_search_attempts from public,anon,authenticated,service_role;
grant select,insert on private.web_search_attempts to service_role;
grant update(observation,http_status,provider_request_id,credits) on private.web_search_attempts to service_role;
revoke all on function private.guard_web_search_attempt() from public,anon,authenticated,service_role;
grant execute on function private.guard_web_search_attempt() to service_role;
