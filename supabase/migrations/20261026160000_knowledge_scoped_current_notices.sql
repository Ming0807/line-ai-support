-- Feature-level current observation for specifically scoped notices; never invent a legal start date.
alter table public.documents drop constraint documents_reviewed_temporal_shape;
alter table public.documents add constraint documents_reviewed_temporal_shape check(
 (temporal_basis='DATED' and current_reviewed_at is null) or
 (temporal_basis='CURRENT_REVIEWED' and current_reviewed_at is not null and effective_from is null and effective_to is null
  and (
   document_type in ('FORM','GUIDE','CALENDAR') and (document_type<>'CALENDAR' or academic_year is not null)
   or document_type='ANNOUNCEMENT' and published_at is not null and cohort is not null
    and audience is not null and audience<>'ALL' and student_type is not null and student_type<>'ALL'
  )));
-- Existing receipt, immutable review timestamp, relationship, RLS and grant guards remain unchanged.
