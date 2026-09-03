-- Migration 00031: indexes matching the feed's actual ORDER BY clauses
--
-- The existing partial indexes cover the filters but not the sorts:
--
--   idx_stories_public  (is_public,  created_at desc) where is_public
--   idx_stories_curated (is_curated, created_at desc) where is_curated
--
-- while `feed/index.ts` orders the trending rail by `read_count` and the
-- curated rail by `like_count`. Postgres can use the partial index to find the
-- rows and then sorts them, which is free at today's seven stories and is a
-- full sort of every public story at any real catalogue size - on the query
-- that runs on every cold open of the app.
--
-- `status` joins the key because both rails filter on `status = 'complete'`,
-- and an index that stops at the sort column still leaves that predicate to be
-- rechecked per row.
--
-- Added CONCURRENTLY: these are on `stories`, and a plain CREATE INDEX takes a
-- lock that blocks the inserts `generate-story` depends on. Concurrent builds
-- cannot run inside a transaction block, which is why this migration contains
-- nothing else.

create index concurrently if not exists idx_stories_trending
  on public.stories (is_public, status, read_count desc)
  where is_public = true;

create index concurrently if not exists idx_stories_curated_ranked
  on public.stories (is_curated, status, like_count desc)
  where is_curated = true;

-- The "for you" rail filters `is_public OR is_curated` and orders by
-- created_at. An OR across the two single-column partial indexes above cannot
-- use either of them, so this index carries the disjunction in its own
-- predicate: it is still partial, but partial on both sides at once, which is
-- what lets the planner match the rail's WHERE clause as a whole.
create index concurrently if not exists idx_stories_visible_recent
  on public.stories (status, created_at desc)
  where is_public = true or is_curated = true;
