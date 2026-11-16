-- CONV-BURST-01 (DEC-206): adaptive Student input collection window.
-- Additive and non-destructive: one new column with a default, one replaced check bound and one
-- replaced trigger function. No row is deleted or rewritten; existing windows already satisfy the
-- wider bound. The ingress sets input_hold from the plain text before encryption (deterministic rule,
-- lib/conversation/input-hold.ts); the hold changes only the waiting time, never meaning or routing.

alter table private.webhook_inbox add column input_hold text not null default 'NORMAL';
alter table private.webhook_inbox add constraint webhook_inbox_input_hold_check check(input_hold in('NORMAL','EXTENDED'));

do $$
declare old_check text;
begin
 select c.conname into old_check from pg_catalog.pg_constraint c
  where c.conrelid='private.student_input_windows'::regclass and c.contype='c'
   and pg_catalog.pg_get_constraintdef(c.oid) like '%ready_at <= (first_received_at + ''00:00:03''::interval)%';
 if old_check is null then raise exception 'STUDENT_INPUT_WINDOW_CAP_CHECK_NOT_FOUND';end if;
 execute pg_catalog.format('alter table private.student_input_windows drop constraint %I',old_check);
end $$;
alter table private.student_input_windows add constraint student_input_windows_ready_cap
 check(ready_at>=last_received_at and ready_at<=first_received_at+interval '15 seconds');

create or replace function private.assign_student_input_window() returns trigger
language plpgsql security invoker set search_path='' as $$
declare selected_window uuid;quiet interval;
begin
 if new.channel<>'STUDENT' or new.event_kind<>'MESSAGE' or new.user_hash is null then return new;end if;
 -- The latest fragment decides the quiet gap: 2.5 s normally, 8 s when it looks unfinished.
 quiet:=case when new.input_hold='EXTENDED' then interval '8 seconds' else interval '2500 milliseconds' end;
 -- The normal ingress already holds all enqueue lanes in sorted order before inserting.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('inbox:STUDENT:'||new.user_hash,0));
 select id into selected_window from private.student_input_windows
  where user_hash=new.user_hash and sealed_at is null and last_received_at<=new.received_at
   and ready_at>new.received_at and first_received_at+interval '15 seconds'>new.received_at
  order by last_event_seq desc limit 1 for update;
 if selected_window is null then
  insert into private.student_input_windows(user_hash,first_event_seq,last_event_seq,first_received_at,last_received_at,ready_at)
   values(new.user_hash,new.event_seq,new.event_seq,new.received_at,new.received_at,new.received_at+quiet)
   returning id into selected_window;
 else
  update private.student_input_windows set last_event_seq=greatest(last_event_seq,new.event_seq),
   last_received_at=new.received_at,ready_at=least(new.received_at+quiet,first_received_at+interval '15 seconds')
   where id=selected_window;
 end if;
 update private.webhook_inbox set input_window_id=selected_window where id=new.id;
 return new;
end $$;
revoke all on function private.assign_student_input_window() from public,anon,authenticated;
grant execute on function private.assign_student_input_window() to service_role;
