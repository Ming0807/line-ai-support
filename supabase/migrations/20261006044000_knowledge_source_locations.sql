-- Add proven all-format provenance without rewriting legacy vectors or documents.
alter table public.knowledge_chunks
 add column source_locations jsonb not null default '[]'::jsonb,
 add column passage_token_count smallint,
 add constraint knowledge_chunks_source_locations_check check (
  jsonb_typeof(source_locations)='array'
  and jsonb_array_length(source_locations)<=16
  and octet_length(source_locations::text)<=65536
  and not jsonb_path_exists(source_locations,'$[*] ? (@.type() != "object")')
  and not jsonb_path_exists(source_locations,'$[*] ? (!exists(@.kind) || @.kind.type() != "string" || (@.kind != "PDF" && @.kind != "DOCX" && @.kind != "XLSX" && @.kind != "CSV" && @.kind != "HTML"))')
 ),
 add constraint knowledge_chunks_passage_token_count_check check (passage_token_count between 1 and 512);

comment on column public.knowledge_chunks.source_locations is
 'Exact source-format locations from reviewed extraction; [] is explicitly incomplete legacy provenance. Application validates ranges/format; no fabricated pagination.';
comment on column public.knowledge_chunks.passage_token_count is
 'Pinned E5 passage count including prefix/special tokens, 1..512 when proven; NULL for legacy/unproven. SQL cannot recount tokens or grant approval.';
-- No new grants, browser policy, automatic indexing/publication/backfill or old-row deletion.
