-- Additive typed projection: keep all historical generic vectors unchanged.
-- Fingerprint includes model/revision/prefix/normalization and excludes endpoint/credentials.
alter table public.knowledge_chunks
 add constraint knowledge_chunks_local_e5_space_check check (
  embedding_fingerprint is distinct from '42259817e85c6d44dc81af6b26fe209c9b744c6342eb4ac1c6bbd2bcdd032f82'
  or (embedding_dimensions=384 and extensions.vector_norm(embedding) between 0.999 and 1.001)
 ),
 add column embedding_e5 extensions.vector(384) generated always as (
  case when embedding_fingerprint='42259817e85c6d44dc81af6b26fe209c9b744c6342eb4ac1c6bbd2bcdd032f82'
   then embedding::extensions.vector(384) else null end
 ) stored;

comment on column public.knowledge_chunks.embedding_e5 is
 'Pinned local multilingual-e5-small CPU normalized 384 cohort; generated from retained canonical vector. URL changes do not change the cohort.';
-- Existing fingerprint/dimension/document partial index supports exact metadata-first search.
-- No ANN, automatic re-embedding, publication, new grants or RLS policies.
