-- Keep this pipeline-incompatible statement isolated so current Supabase CLI
-- migration runners execute it outside their batched transaction.
create index concurrently if not exists idx_stories_title_trgm
    on public.stories
    using gin (title extensions.gin_trgm_ops);
