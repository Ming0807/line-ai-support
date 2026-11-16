-- NATURAL-ESCALATE-01 (DEC-209): the AI opens a staff case itself when it cannot help, so a support outcome may now be
-- AI_ESCALATED (triggered by the Student's own verified LINE message) besides the button-confirmed kinds.
-- Additive and non-destructive: only the two check constraints are widened; no row is changed or deleted.
do $$
declare name text;
begin
 for name in select c.conname from pg_catalog.pg_constraint c
  where c.conrelid='private.ai_support_outcomes'::regclass and c.contype='c'
   and pg_catalog.pg_get_constraintdef(c.oid) like '%USER_CONFIRMED_ESCALATED%' loop
  execute pg_catalog.format('alter table private.ai_support_outcomes drop constraint %I',name);
 end loop;
end $$;
alter table private.ai_support_outcomes add constraint ai_support_outcomes_kind_check
 check(kind in ('USER_CONFIRMED_SOLVED','USER_CONFIRMED_ESCALATED','AI_ESCALATED'));
alter table private.ai_support_outcomes add constraint ai_support_outcomes_ticket_check
 check((kind='USER_CONFIRMED_SOLVED' and ticket_id is null) or (kind in ('USER_CONFIRMED_ESCALATED','AI_ESCALATED') and ticket_id is not null));
