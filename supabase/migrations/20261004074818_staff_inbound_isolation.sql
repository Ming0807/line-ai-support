-- Staff intake is private and cannot share Student sessions or message rows.
alter table private.webhook_inbox add constraint webhook_inbox_id_channel_key unique(id,channel);

create table private.staff_inbound_messages (
 id uuid primary key default gen_random_uuid(),
 source_event_id uuid not null unique,
 source_event_channel text generated always as ('STAFF'::text) stored,
 user_hash text not null,
 line_message_id text not null unique,
 content_encrypted text not null,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(source_event_id,source_event_channel) references private.webhook_inbox(id,channel)
);
create index staff_inbound_user_time_idx on private.staff_inbound_messages(user_hash,created_at);
alter table private.staff_inbound_messages enable row level security;
revoke all on private.staff_inbound_messages from public,anon,authenticated;
grant all on private.staff_inbound_messages to service_role;
comment on table private.staff_inbound_messages is 'Private encrypted Staff OA intake; no Student identity creation or untrusted staff enrollment.';
