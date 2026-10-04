SET local check_function_bodies = off;

CREATE SCHEMA "private";

CREATE TABLE "private"."delivery_attempts" (
  "id"          bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "outbox_id"   uuid                     NOT NULL,
  "http_status" integer,
  "request_id"  text,
  "error_code"  text,
  "accepted"    boolean                  NOT NULL DEFAULT false,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY (id)
);

ALTER TABLE "private"."delivery_attempts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."line_identities" (
  "line_session_id"   uuid                     NOT NULL,
  "user_hash"         text                     NOT NULL,
  "user_id_encrypted" text                     NOT NULL,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "line_identities_pkey" PRIMARY KEY (line_session_id),
  CONSTRAINT "line_identities_user_hash_key" UNIQUE (user_hash)
);

ALTER TABLE "private"."line_identities"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."message_outbox" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "idempotency_key"   text                     NOT NULL,
  "line_retry_key"    uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "line_session_id"   uuid,
  "conversation_id"   uuid,
  "ticket_id"         uuid,
  "kind"              text                     NOT NULL,
  "channel"           text                     NOT NULL DEFAULT 'STUDENT'::text,
  "payload_encrypted" text                     NOT NULL,
  "status"            text                     NOT NULL DEFAULT 'PENDING'::text,
  "attempts"          integer                  NOT NULL DEFAULT 0,
  "available_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "lease_token"       uuid,
  "lease_until"       timestamp with time zone,
  "first_attempt_at"  timestamp with time zone,
  "last_error_code"   text,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at"      timestamp with time zone,
  CONSTRAINT "message_outbox_attempts_check" CHECK ((attempts >= 0)),
  CONSTRAINT "message_outbox_channel_check" CHECK ((channel = ANY (ARRAY['STUDENT'::text, 'STAFF'::text]))),
  CONSTRAINT "message_outbox_idempotency_key_key" UNIQUE (idempotency_key),
  CONSTRAINT "message_outbox_kind_check" CHECK ((kind = ANY (ARRAY['AI'::text, 'STAFF'::text, 'NOTIFICATION'::text, 'SYSTEM'::text]))),
  CONSTRAINT "message_outbox_line_retry_key_key" UNIQUE (line_retry_key),
  CONSTRAINT "message_outbox_pkey" PRIMARY KEY (id),
  CONSTRAINT "message_outbox_status_check" CHECK ((status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text, 'SENT'::text, 'DEAD'::text, 'SUPPRESSED'::text])))
);

ALTER TABLE "private"."message_outbox"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "private"."webhook_inbox" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "channel"           text                     NOT NULL,
  "event_id"          text                     NOT NULL,
  "user_hash"         text,
  "payload_encrypted" text                     NOT NULL,
  "status"            text                     NOT NULL DEFAULT 'PENDING'::text,
  "attempts"          integer                  NOT NULL DEFAULT 0,
  "available_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "lease_token"       uuid,
  "lease_until"       timestamp with time zone,
  "last_error_code"   text,
  "received_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at"      timestamp with time zone,
  CONSTRAINT "webhook_inbox_attempts_check" CHECK ((attempts >= 0)),
  CONSTRAINT "webhook_inbox_channel_check" CHECK ((channel = ANY (ARRAY['STUDENT'::text, 'STAFF'::text]))),
  CONSTRAINT "webhook_inbox_channel_event_id_key" UNIQUE (channel, event_id),
  CONSTRAINT "webhook_inbox_pkey" PRIMARY KEY (id),
  CONSTRAINT "webhook_inbox_status_check" CHECK ((status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text, 'DONE'::text, 'DEAD'::text])))
);

ALTER TABLE "private"."webhook_inbox"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."conversations" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "line_session_id"   uuid                     NOT NULL,
  "conversation_type" text                     NOT NULL DEFAULT 'GENERAL'::text,
  "mode"              text                     NOT NULL DEFAULT 'AI'::text,
  "status"            text                     NOT NULL DEFAULT 'ACTIVE'::text,
  "topic"             text,
  "active_ticket_id"  uuid,
  "started_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "ended_at"          timestamp with time zone,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "conversations_conversation_type_check" CHECK ((conversation_type = ANY (ARRAY['GENERAL'::text, 'SUPPORT'::text, 'TICKET'::text]))),
  CONSTRAINT "conversations_id_line_session_id_key" UNIQUE (id, line_session_id),
  CONSTRAINT "conversations_mode_check" CHECK ((mode = ANY (ARRAY['AI'::text, 'HUMAN'::text]))),
  CONSTRAINT "conversations_pkey" PRIMARY KEY (id),
  CONSTRAINT "conversations_status_check" CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'WAITING'::text, 'RESOLVED'::text, 'CLOSED'::text])))
);

ALTER TABLE "public"."conversations"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."conversations" FROM "anon";

CREATE TABLE "public"."departments" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "code"        text                     NOT NULL,
  "name_th"     text                     NOT NULL,
  "name_en"     text                     NOT NULL,
  "description" text,
  "active"      boolean                  NOT NULL DEFAULT true,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "departments_code_key" UNIQUE (code),
  CONSTRAINT "departments_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."departments"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."departments" FROM "anon";

CREATE TABLE "public"."line_sessions" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "anonymous_code"  text                     NOT NULL,
  "active"          boolean                  NOT NULL DEFAULT true,
  "last_message_at" timestamp with time zone,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "line_sessions_anonymous_code_key" UNIQUE (anonymous_code),
  CONSTRAINT "line_sessions_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."line_sessions"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."line_sessions" FROM "anon";

CREATE TABLE "public"."messages" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "conversation_id" uuid                     NOT NULL,
  "ticket_id"       uuid,
  "sender_type"     text                     NOT NULL,
  "sender_staff_id" uuid,
  "message_type"    text                     NOT NULL DEFAULT 'TEXT'::text,
  "content"         text                     NOT NULL,
  "line_message_id" text,
  "source_event_id" uuid,
  "metadata"        jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "messages_check" CHECK (((sender_type = 'STAFF'::text) = (sender_staff_id IS NOT NULL))),
  CONSTRAINT "messages_line_message_id_key" UNIQUE (line_message_id),
  CONSTRAINT "messages_message_type_check" CHECK ((message_type = ANY (ARRAY['TEXT'::text, 'IMAGE'::text, 'FILE'::text, 'SYSTEM'::text]))),
  CONSTRAINT "messages_pkey" PRIMARY KEY (id),
  CONSTRAINT "messages_sender_type_check" CHECK ((sender_type = ANY (ARRAY['USER'::text, 'AI'::text, 'STAFF'::text, 'SYSTEM'::text]))),
  CONSTRAINT "messages_source_event_id_key" UNIQUE (source_event_id)
);

ALTER TABLE "public"."messages"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."messages" FROM "anon";

CREATE TABLE "public"."staff_profiles" (
  "id"                  uuid                     NOT NULL,
  "department_id"       uuid,
  "display_name"        text                     NOT NULL,
  "role"                text                     NOT NULL,
  "active"              boolean                  NOT NULL DEFAULT true,
  "can_view_sensitive"  boolean                  NOT NULL DEFAULT false,
  "can_view_restricted" boolean                  NOT NULL DEFAULT false,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "staff_profiles_check" CHECK (((role = ANY (ARRAY['ADMIN'::text, 'SUPER_ADMIN'::text])) OR (department_id IS NOT NULL))),
  CONSTRAINT "staff_profiles_pkey" PRIMARY KEY (id),
  CONSTRAINT "staff_profiles_role_check" CHECK ((role = ANY (ARRAY['STAFF'::text, 'SUPERVISOR'::text, 'ADMIN'::text, 'SUPER_ADMIN'::text])))
);

ALTER TABLE "public"."staff_profiles"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."staff_profiles" FROM "anon";

CREATE TABLE "public"."ticket_history" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "ticket_id"   uuid                     NOT NULL,
  "action"      text                     NOT NULL,
  "from_status" text,
  "to_status"   text,
  "actor_type"  text                     NOT NULL,
  "actor_id"    uuid,
  "metadata"    jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ticket_history_actor_type_check" CHECK ((actor_type = ANY (ARRAY['STAFF'::text, 'SYSTEM'::text, 'USER'::text, 'AI'::text]))),
  CONSTRAINT "ticket_history_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."ticket_history"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."ticket_history" FROM "anon";

CREATE TABLE "public"."tickets" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "ticket_seq"        bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "line_session_id"   uuid                     NOT NULL,
  "conversation_id"   uuid                     NOT NULL,
  "department_id"     uuid                     NOT NULL,
  "assigned_staff_id" uuid,
  "category"          text                     NOT NULL DEFAULT 'GENERAL'::text,
  "subcategory"       text,
  "problem_summary"   text                     NOT NULL,
  "priority"          text                     NOT NULL DEFAULT 'MEDIUM'::text,
  "severity"          text                     NOT NULL DEFAULT 'NORMAL'::text,
  "status"            text                     NOT NULL DEFAULT 'WAITING_STAFF'::text,
  "mode"              text                     NOT NULL DEFAULT 'AI'::text,
  "sensitive_level"   text                     NOT NULL DEFAULT 'GENERAL'::text,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "accepted_at"       timestamp with time zone,
  "resolved_at"       timestamp with time zone,
  "closed_at"         timestamp with time zone,
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "tickets_id_conversation_id_key" UNIQUE (id, conversation_id),
  CONSTRAINT "tickets_mode_check" CHECK ((mode = ANY (ARRAY['AI'::text, 'HUMAN'::text]))),
  CONSTRAINT "tickets_pkey" PRIMARY KEY (id),
  CONSTRAINT "tickets_priority_check" CHECK ((priority = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text, 'CRITICAL'::text]))),
  CONSTRAINT "tickets_sensitive_level_check" CHECK ((sensitive_level = ANY (ARRAY['GENERAL'::text, 'SENSITIVE'::text, 'RESTRICTED'::text]))),
  CONSTRAINT "tickets_severity_check" CHECK ((severity = ANY (ARRAY['NORMAL'::text, 'ELEVATED'::text, 'MAJOR'::text, 'CRITICAL'::text]))),
  CONSTRAINT "tickets_status_check"
    CHECK
    ((status = ANY (ARRAY['NEW'::text, 'AI_HANDLING'::text, 'WAITING_STAFF'::text, 'STAFF_HANDLING'::text, 'WAITING_USER'::text, 'RESOLVED'::text, 'CLOSED'::text,
    'CANCELLED'::text]))),
  CONSTRAINT "tickets_ticket_seq_key" UNIQUE (ticket_seq)
);

ALTER TABLE "public"."tickets"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."tickets" FROM "anon";

ALTER TABLE "public"."tickets"
  ADD COLUMN "ticket_no" text GENERATED ALWAYS AS (('YRU-'::text || lpad((ticket_seq)::text, 8, '0'::text))) STORED;

CREATE OR REPLACE FUNCTION private.can_access_conversation (
  target uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select private.is_active_staff() and
 ((exists(select 1 from public.tickets t where t.conversation_id=target)
 and not exists(select 1 from public.tickets t where t.conversation_id=target and not private.can_access_scope(t.department_id,t.sensitive_level)))
 or (not exists(select 1 from public.tickets t where t.conversation_id=target)
 and exists(select 1 from public.staff_profiles s where s.id=(select auth.uid()) and s.active and s.role='SUPER_ADMIN')))
$function$;

CREATE OR REPLACE FUNCTION private.can_access_scope (
  dept        uuid,
  sensitivity text
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select exists(select 1 from public.staff_profiles s
 where s.id=(select auth.uid()) and s.active
 and (s.role='SUPER_ADMIN' or (s.role in ('STAFF','SUPERVISOR') and s.department_id=dept))
 and (sensitivity='GENERAL' or s.role='SUPER_ADMIN'
      or (sensitivity='SENSITIVE' and s.can_view_sensitive)
      or (sensitivity='RESTRICTED' and s.can_view_restricted)))
$function$;

CREATE OR REPLACE FUNCTION private.can_access_ticket (
  target uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select exists(select 1 from public.tickets t where t.id=target and private.can_access_scope(t.department_id,t.sensitive_level))
$function$;

CREATE OR REPLACE FUNCTION private.is_active_staff()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
 select exists(select 1 from public.staff_profiles where id=(select auth.uid()) and active)
$function$;

ALTER TABLE "private"."delivery_attempts"
  ADD CONSTRAINT "delivery_attempts_outbox_id_fkey" FOREIGN KEY (outbox_id) REFERENCES private.message_outbox(id);

ALTER TABLE "private"."message_outbox"
  ADD CONSTRAINT "message_outbox_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);

ALTER TABLE "private"."line_identities"
  ADD CONSTRAINT "line_identities_line_session_id_fkey" FOREIGN KEY (line_session_id) REFERENCES public.line_sessions(id) ON DELETE CASCADE;

ALTER TABLE "private"."message_outbox"
  ADD CONSTRAINT "message_outbox_line_session_id_fkey" FOREIGN KEY (line_session_id) REFERENCES public.line_sessions(id);

ALTER TABLE "public"."conversations"
  ADD CONSTRAINT "conversations_line_session_id_fkey" FOREIGN KEY (line_session_id) REFERENCES public.line_sessions(id);

ALTER TABLE "public"."messages"
  ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES public.conversations(id);

ALTER TABLE "public"."staff_profiles"
  ADD CONSTRAINT "staff_profiles_department_id_fkey" FOREIGN KEY (department_id) REFERENCES public.departments(id);

ALTER TABLE "public"."staff_profiles"
  ADD CONSTRAINT "staff_profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."messages"
  ADD CONSTRAINT "messages_sender_staff_id_fkey" FOREIGN KEY (sender_staff_id) REFERENCES public.staff_profiles(id);

ALTER TABLE "public"."ticket_history"
  ADD CONSTRAINT "ticket_history_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES public.staff_profiles(id);

ALTER TABLE "public"."tickets"
  ADD CONSTRAINT "tickets_assigned_staff_id_fkey" FOREIGN KEY (assigned_staff_id) REFERENCES public.staff_profiles(id);

ALTER TABLE "public"."tickets"
  ADD CONSTRAINT "tickets_conversation_id_line_session_id_fkey" FOREIGN KEY (conversation_id, line_session_id) REFERENCES public.conversations(id, line_session_id);

ALTER TABLE "public"."tickets"
  ADD CONSTRAINT "tickets_department_id_fkey" FOREIGN KEY (department_id) REFERENCES public.departments(id);

ALTER TABLE "public"."conversations"
  ADD CONSTRAINT "conversation_active_ticket_fk" FOREIGN KEY (active_ticket_id, id) REFERENCES public.tickets(id, conversation_id);

ALTER TABLE "public"."messages"
  ADD CONSTRAINT "messages_ticket_id_conversation_id_fkey" FOREIGN KEY (ticket_id, conversation_id) REFERENCES public.tickets(id, conversation_id);

ALTER TABLE "public"."tickets"
  ADD CONSTRAINT "tickets_line_session_id_fkey" FOREIGN KEY (line_session_id) REFERENCES public.line_sessions(id);

ALTER TABLE "private"."message_outbox"
  ADD CONSTRAINT "message_outbox_ticket_id_fkey" FOREIGN KEY (ticket_id) REFERENCES public.tickets(id);

ALTER TABLE "public"."ticket_history"
  ADD CONSTRAINT "ticket_history_ticket_id_fkey" FOREIGN KEY (ticket_id) REFERENCES public.tickets(id);

ALTER TABLE "public"."tickets"
  ADD CONSTRAINT "tickets_ticket_no_key" UNIQUE (ticket_no);

CREATE INDEX delivery_attempts_outbox_idx ON private.delivery_attempts USING btree (outbox_id);

CREATE INDEX inbox_ready_idx ON private.webhook_inbox USING btree (available_at, received_at)
  WHERE (status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text]));

CREATE INDEX inbox_user_order_idx ON private.webhook_inbox USING btree (channel, user_hash, received_at, id)
  WHERE (status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text]));

CREATE INDEX outbox_conversation_idx ON private.message_outbox USING btree (conversation_id);

CREATE INDEX outbox_ready_idx ON private.message_outbox USING btree (available_at, created_at)
  WHERE (status = ANY (ARRAY['PENDING'::text, 'PROCESSING'::text]));

CREATE INDEX outbox_session_idx ON private.message_outbox USING btree (line_session_id);

CREATE INDEX outbox_ticket_idx ON private.message_outbox USING btree (ticket_id);

CREATE INDEX conversations_active_ticket_idx ON public.conversations USING btree (active_ticket_id);

CREATE INDEX conversations_session_idx ON public.conversations USING btree (line_session_id, created_at DESC);

CREATE INDEX messages_conversation_idx ON public.messages USING btree (conversation_id, created_at);

CREATE INDEX messages_sender_staff_idx ON public.messages USING btree (sender_staff_id);

CREATE INDEX messages_ticket_idx ON public.messages USING btree (ticket_id, created_at);

CREATE INDEX staff_profiles_department_idx ON public.staff_profiles USING btree (department_id);

CREATE INDEX ticket_history_actor_idx ON public.ticket_history USING btree (actor_id);

CREATE INDEX ticket_history_ticket_idx ON public.ticket_history USING btree (ticket_id, created_at);

CREATE INDEX tickets_assigned_idx ON public.tickets USING btree (assigned_staff_id);

CREATE INDEX tickets_conversation_idx ON public.tickets USING btree (conversation_id);

CREATE INDEX tickets_department_status_idx ON public.tickets USING btree (department_id, status, created_at DESC);

CREATE INDEX tickets_session_idx ON public.tickets USING btree (line_session_id);

CREATE POLICY "conversations_scoped_read" ON "public"."conversations"
  FOR SELECT
  TO "authenticated"
  USING (private.can_access_conversation(id));

CREATE POLICY "departments_staff_read" ON "public"."departments"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT private.is_active_staff() AS is_active_staff));

CREATE POLICY "sessions_scoped_read" ON "public"."line_sessions"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.tickets t
  WHERE ((t.line_session_id = line_sessions.id) AND private.can_access_scope(t.department_id, t.sensitive_level)))));

CREATE POLICY "messages_scoped_read" ON "public"."messages"
  FOR SELECT
  TO "authenticated"
  USING (
CASE
    WHEN (ticket_id IS NOT NULL) THEN private.can_access_ticket(ticket_id)
    ELSE private.can_access_conversation(conversation_id)
END);

CREATE POLICY "staff_self_read" ON "public"."staff_profiles"
  FOR SELECT
  TO "authenticated"
  USING ((id = ( SELECT auth.uid() AS uid)));

CREATE POLICY "history_scoped_read" ON "public"."ticket_history"
  FOR SELECT
  TO "authenticated"
  USING (private.can_access_ticket(ticket_id));

CREATE POLICY "tickets_scoped_read" ON "public"."tickets"
  FOR SELECT
  TO "authenticated"
  USING (private.can_access_scope(department_id, sensitive_level));

REVOKE ALL ON FUNCTION "private"."can_access_conversation"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."can_access_conversation"(uuid) TO "authenticated", "service_role";

REVOKE ALL ON FUNCTION "private"."can_access_scope"(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."can_access_scope"(uuid, text) TO "authenticated", "service_role";

REVOKE ALL ON FUNCTION "private"."can_access_ticket"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."can_access_ticket"(uuid) TO "authenticated", "service_role";

REVOKE ALL ON FUNCTION "private"."is_active_staff"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "private"."is_active_staff"() TO "authenticated", "service_role";

GRANT USAGE ON SCHEMA "private" TO "authenticated", "service_role";

GRANT SELECT, USAGE ON SEQUENCE "private"."delivery_attempts_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."tickets_ticket_seq_seq" FROM "anon";


REVOKE ALL ON SEQUENCE "public"."tickets_ticket_seq_seq" FROM "authenticated";


REVOKE ALL ON SEQUENCE "public"."tickets_ticket_seq_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."tickets_ticket_seq_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."tickets_ticket_seq_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."tickets_ticket_seq_seq" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "private"."delivery_attempts" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "private"."line_identities" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "private"."message_outbox" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "private"."webhook_inbox" TO "service_role";

REVOKE ALL ON TABLE "public"."conversations" FROM "authenticated";

GRANT SELECT ON TABLE "public"."conversations" TO "authenticated";

REVOKE ALL ON TABLE "public"."conversations" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."conversations" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."conversations" TO "service_role";

REVOKE ALL ON TABLE "public"."departments" FROM "authenticated";

GRANT SELECT ON TABLE "public"."departments" TO "authenticated";

REVOKE ALL ON TABLE "public"."departments" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."departments" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."departments" TO "service_role";

REVOKE ALL ON TABLE "public"."line_sessions" FROM "authenticated";

GRANT SELECT ON TABLE "public"."line_sessions" TO "authenticated";

REVOKE ALL ON TABLE "public"."line_sessions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."line_sessions" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."line_sessions" TO "service_role";

REVOKE ALL ON TABLE "public"."messages" FROM "authenticated";

GRANT SELECT ON TABLE "public"."messages" TO "authenticated";

REVOKE ALL ON TABLE "public"."messages" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."messages" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."messages" TO "service_role";

REVOKE ALL ON TABLE "public"."staff_profiles" FROM "authenticated";

GRANT SELECT ON TABLE "public"."staff_profiles" TO "authenticated";

REVOKE ALL ON TABLE "public"."staff_profiles" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."staff_profiles" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."staff_profiles" TO "service_role";

REVOKE ALL ON TABLE "public"."ticket_history" FROM "authenticated";

GRANT SELECT ON TABLE "public"."ticket_history" TO "authenticated";

REVOKE ALL ON TABLE "public"."ticket_history" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ticket_history" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ticket_history" TO "service_role";

REVOKE ALL ON TABLE "public"."tickets" FROM "authenticated";

GRANT SELECT ON TABLE "public"."tickets" TO "authenticated";

REVOKE ALL ON TABLE "public"."tickets" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tickets" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tickets" TO "service_role";
