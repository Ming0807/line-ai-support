-- CLI unavailable locally; UTC prefix read from the clock tool before authoring.
create function private.valid_line_message_hashes(value text[]) returns boolean
language sql immutable strict set search_path='' as $$
 select pg_catalog.array_ndims(value)=1 and pg_catalog.cardinality(value) between 1 and 5
  and not exists(select 1 from pg_catalog.unnest(value) v(hash) where hash is null or hash!~'^[a-f0-9]{64}$')
  and (select count(distinct hash) from pg_catalog.unnest(value) v(hash))=pg_catalog.cardinality(value);
$$;
revoke all on function private.valid_line_message_hashes(text[]) from public,anon,authenticated;
grant execute on function private.valid_line_message_hashes(text[]) to service_role;

create table private.line_delivery_receipts(
 outbox_id uuid primary key references private.message_outbox(id) on delete cascade,
 message_hashes text[] not null check(private.valid_line_message_hashes(message_hashes)),
 consistent boolean not null default true,
 created_at timestamptz not null default clock_timestamp()
);
create index line_delivery_receipts_hash_idx on private.line_delivery_receipts using gin(message_hashes);
alter table private.line_delivery_receipts enable row level security;
revoke all on private.line_delivery_receipts from public,anon,authenticated;
grant select,insert,update on private.line_delivery_receipts to service_role;
