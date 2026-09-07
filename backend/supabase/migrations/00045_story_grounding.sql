-- Migration 00045: what a grounded story has to remember
--
-- `_shared/grounding-card.ts` builds a fact card for the real entities a story
-- names -- who they are, how they are addressed, what a scene around them looks
-- like -- and feeds it to the generator as a distinct prompt layer. This
-- migration is the storage that makes that survive past chapter one.
--
-- Three objects, and they answer three different questions.
--
-- ---------------------------------------------------------------------------
-- 1. stories.grounding -- so chapter 7 agrees with chapter 1
-- ---------------------------------------------------------------------------
-- A card is built once, on the generation that first needed it. Without
-- storage, `continue-story` would rebuild it per chapter: a second card call
-- per chapter, a different card each time (these are model outputs, not
-- lookups), and a series in which the honorific rules quietly change at chapter
-- four. Persisting the validated cards makes the grounding a property of the
-- story rather than of the request that happened to write a chapter.
--
-- It stores the *validated* cards -- what `validateGroundingCards` returned --
-- never a raw model response and never retrieved web text. Raw retrieval is
-- admitted only to the extractor call, whose output channel is a strict schema;
-- putting it in a column that is later interpolated into a story prompt would
-- undo that containment through the database.
--
-- ---------------------------------------------------------------------------
-- 2. stories.grounding_entities -- so a future gate is a WHERE clause
-- ---------------------------------------------------------------------------
-- The classification, kept even when nothing was grounded: which entities the
-- idea named and what class each was assigned.
--
-- This column exists for a job it does not do yet. Publishing a public story
-- that names a living person, or a private individual, is a moderation question
-- this product will eventually have to answer, and the difference between
-- answering it with
--
--     where grounding_entities @> '[{"entity_class": "living_public_figure"}]'
--
-- and answering it by re-classifying every story ever written is the difference
-- between a query and a migration that spends real money on an LLM per row.
-- Recording a fact that is cheap now and unrecoverable later is the whole
-- argument for the column; it is written on every generation, grounded or not.
--
-- It records names and classes only. Not the idea, not confidence-weighted
-- reasoning about a named person -- the same rule `AGENTS.md` sets for
-- `error_events.context`: identifiers and enums, never free user text.
--
-- ---------------------------------------------------------------------------
-- 3. entity_grounding -- so Shivaji is paid for once
-- ---------------------------------------------------------------------------
-- Cards are per-entity, not per-story. Shivaji Maharaj, Taylor Swift and the
-- Colosseum will each be asked for by thousands of different stories, and each
-- request is otherwise an LLM call -- or, in phase 2, a search plus an LLM call
-- -- to reproduce a card that is byte-identical to the one built an hour ago.
-- The cache turns the tail of that distribution into a single row read.
--
-- Keyed on a normalized name so "Shivaji Maharaj", "shivaji  maharaj" and
-- "Shivaji Maharaj." are one row rather than three. The normalization is
-- `entity_grounding_key()` below, and it is the same rule as
-- `groundingCacheKey()` in `_shared/grounding-types.ts` -- see the note on that
-- function for why diacritics are deliberately not folded.
--
-- Expiry is by class, because what goes stale is not popularity but the facts:
--
--     historical / event        365 days   dates do not move
--     living person / brand      30 days   the public situation moves in weeks,
--                                          and post-cutoff detail is exactly
--                                          what an informed reader catches
--     place                      90 days   slow drift; a street renamed
--
-- `expires_at` is computed by the database on write rather than by the caller,
-- so a caller that forgets cannot install an immortal card, and the TTL policy
-- lives in one place instead of in every Edge Function that writes one.

-- ---------------------------------------------------------------------------
-- stories: the cards, and the classification
-- ---------------------------------------------------------------------------

alter table public.stories
  add column if not exists grounding jsonb not null default '[]'::jsonb,
  add column if not exists grounding_entities jsonb not null default '[]'::jsonb;

comment on column public.stories.grounding is
  'Validated grounding fact cards for this story, as returned by validateGroundingCards in _shared/grounding-card.ts. Re-sent on every continuation so a series stays consistent with its first chapter. Never raw model output and never retrieved web text.';
comment on column public.stories.grounding_entities is
  'Entity classification for this story''s idea: canonical name and entity class per entity, written whether or not anything was grounded. Exists so a future publish gate can be a WHERE clause instead of a backfill that re-classifies the corpus. Names and enums only, never user free text.';

-- Both must be arrays. A jsonb column with no shape constraint accepts a
-- string, a number or an object, and every consumer then has to defend against
-- three shapes it will never legitimately see. Added NOT VALID and validated at
-- the end of this file, following 00029/00032 and 00036: ADD CONSTRAINT holds
-- ACCESS EXCLUSIVE for its scan and `stories` is hot. The scan is trivial here
-- -- every existing row carries the '[]' default -- so it is validated in the
-- same migration rather than deferred to a companion file.
alter table public.stories
  drop constraint if exists stories_grounding_is_array;
alter table public.stories
  add constraint stories_grounding_is_array
  check (pg_catalog.jsonb_typeof(grounding) = 'array')
  not valid;

alter table public.stories
  drop constraint if exists stories_grounding_entities_is_array;
alter table public.stories
  add constraint stories_grounding_entities_is_array
  check (pg_catalog.jsonb_typeof(grounding_entities) = 'array')
  not valid;

-- Neither column joins the narrow owner-update grant from 00015, for the same
-- reason 00029 withheld `cover_status` and 00044 withheld `cover_regen_count`:
-- they are server-derived. `grounding` is interpolated into a story prompt on
-- every continuation, so a client that could write it directly would have a
-- free channel into the generator's system message on a paid path -- which is
-- exactly the injection surface the fencing in `grounding-card.ts` exists to
-- close. `validateGroundingCards` re-caps whatever it reads back from here
-- anyway, but a column a client cannot write is a stronger statement than a
-- validator a future caller might forget to run.

-- A partial index, because the interesting query is "stories that named
-- somebody" and the overwhelming majority named nobody. Indexing the empty
-- default would store a btree entry per story to answer a question nobody asks;
-- `jsonb_path_ops` keeps the index to containment queries, which is the only
-- shape the future publish gate needs.
create index if not exists idx_stories_grounding_entities
  on public.stories using gin (grounding_entities jsonb_path_ops)
  where grounding_entities <> '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- entity_grounding: the shared card cache
-- ---------------------------------------------------------------------------

-- The normalization that makes two spellings one row. Mirrors
-- groundingCacheKey() in _shared/grounding-types.ts; if one changes the other
-- must, because a disagreement does not error -- it silently halves the hit
-- rate and writes duplicate rows nobody notices.
--
-- IMMUTABLE so it can be used in the generated column below. It reads no
-- tables, no settings and no clock, so the label is honest.
create or replace function public.entity_grounding_key(p_name text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
    select pg_catalog.btrim(
        pg_catalog.regexp_replace(
            -- `normalize` is left unqualified deliberately. Its second
            -- argument is a grammar keyword, not a value, and schema-qualifying
            -- the call drops out of that special grammar: pg_catalog.normalize(
            -- p_name, nfkc) parses NFKC as a column reference and fails with
            -- "column nfkc does not exist". Everything else here stays
            -- qualified, as `set search_path = ''` requires.
            pg_catalog.lower(normalize(p_name, NFKC)),
            '[^[:alnum:]]+', ' ', 'g'
        )
    )
$$;

comment on function public.entity_grounding_key(text) is
  'Normalizes a canonical entity name to the entity_grounding cache key: NFKC, lowercased, non-alphanumerics folded to single spaces, trimmed. Diacritics are deliberately preserved -- folding them across Latin collides genuinely different names, and a cache that returns the wrong entity is worse than a miss. Mirrors groundingCacheKey() in _shared/grounding-types.ts.';

-- TTL by class, in one place. A caller that computed its own expiry would be a
-- second policy, and the two would disagree the first time one was tuned.
create or replace function public.entity_grounding_ttl_days(p_entity_class text)
returns integer
language sql
immutable
set search_path = ''
as $$
    select case p_entity_class
        when 'historical_public_figure' then 365
        when 'real_event' then 365
        when 'real_place' then 90
        when 'living_public_figure' then 30
        when 'organization_brand' then 30
        -- Unknown classes get the shortest TTL rather than the longest. A class
        -- added to the TypeScript union and not to this function should expire
        -- quickly and be rebuilt, not be cached for a year under a policy that
        -- was never chosen for it.
        else 30
    end
$$;

comment on function public.entity_grounding_ttl_days(text) is
  'Cache lifetime in days for a grounding card, by entity class. Historical figures and events 365, places 90, living people and brands 30. Unknown classes fall to the shortest TTL. Mirrors GROUNDING_TTL_DAYS in _shared/grounding-types.ts.';

create table if not exists public.entity_grounding (
    id uuid primary key default gen_random_uuid(),
    -- The name as the card calls it, preserved for display and debugging.
    canonical_name text not null,
    -- The lookup key, derived rather than supplied. A caller that passed its own
    -- key could write a row that no read would ever find, and the miss would
    -- look like a cold cache forever.
    cache_key text not null generated always as (
        public.entity_grounding_key(canonical_name)
    ) stored,
    entity_class text not null,
    -- The validated card, same shape as one element of stories.grounding.
    card jsonb not null,
    -- 'model_knowledge' or 'web_extract'. Kept so a phase 2 rollout can measure
    -- the two populations against each other, and so a bad retrieval run can be
    -- deleted by source instead of wholesale.
    source text not null default 'model_knowledge',
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    constraint entity_grounding_class_check check (
        entity_class in (
            'historical_public_figure',
            'living_public_figure',
            'real_place',
            'real_event',
            'organization_brand'
        )
    ),
    constraint entity_grounding_source_check check (
        source in ('model_knowledge', 'web_extract')
    ),
    constraint entity_grounding_card_is_object check (
        pg_catalog.jsonb_typeof(card) = 'object'
    ),
    constraint entity_grounding_key_not_empty check (cache_key <> '')
);

-- `fictional_character` and `private_individual` are absent from the class
-- check on purpose, and it is the second one that matters. A private individual
-- has no card by construction -- they are never classified searchable, never
-- grounded, and never extracted. A row for one here would mean a real person's
-- details, derived from one user's private story idea, sitting in a cache that
-- every other user's generation reads from. The constraint makes that
-- unrepresentable rather than merely unlikely; `fictional_character` is
-- excluded for the cheaper reason that it is never worth a row.

comment on table public.entity_grounding is
  'Shared, expiring cache of grounding fact cards keyed on a normalized canonical entity name. Popular entities are requested by thousands of stories and cost one LLM call each without it. Public entities only -- the class check makes a private individual unrepresentable.';
comment on column public.entity_grounding.cache_key is
  'Generated from canonical_name by entity_grounding_key(). Never supplied by a caller: a caller-chosen key can be written and never found.';
comment on column public.entity_grounding.expires_at is
  'Set by entity_grounding_upsert() from entity_grounding_ttl_days(). A stale card is worse than a miss for a living person, so reads must filter on this rather than treating any row as a hit.';

-- One live row per entity. The unique index is on the derived key, not on
-- canonical_name, which is the point of deriving it.
create unique index if not exists idx_entity_grounding_cache_key
  on public.entity_grounding (cache_key);

-- The retention sweep's index. Partial on nothing -- every row expires -- but
-- ordered so deleting the expired tail is a range scan rather than a seq scan
-- over a table whose whole purpose is to grow.
create index if not exists idx_entity_grounding_expires_at
  on public.entity_grounding (expires_at);

-- ---------------------------------------------------------------------------
-- entity_grounding_lookup
-- ---------------------------------------------------------------------------
-- A hit is a live row. Expiry is applied here rather than left to the caller
-- because "did you remember to check expires_at" is the kind of condition that
-- is right in the first caller and missing in the third, and the failure is
-- silent: a two-year-old card about a living person reads exactly like a fresh
-- one and is instructed to the generator as true.
create or replace function public.entity_grounding_lookup(
    p_canonical_name text
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select e.card
    from public.entity_grounding e
    where e.cache_key = public.entity_grounding_key(p_canonical_name)
      and e.expires_at > pg_catalog.now()
$$;

-- ---------------------------------------------------------------------------
-- entity_grounding_upsert
-- ---------------------------------------------------------------------------
-- Write-through, last writer wins, expiry computed here.
--
-- Last-writer-wins is correct for this table in a way it is not for the credit
-- ledger: two generations racing on the same entity have each produced a valid
-- card, either is a fine answer, and the loser's work is simply discarded. No
-- advisory lock, no serialization -- the contention this table sees is exactly
-- the popular-entity case it exists to make cheap, and blocking two story
-- generations against each other to arbitrate which description of the
-- Colosseum wins would be a worse outcome than the race.
--
-- `expires_at` is recomputed on every write, so refreshing a card refreshes its
-- lifetime. That is deliberate: the row that gets rewritten is the one being
-- actively requested, and re-dating it from the original insert would expire a
-- hot entry on a schedule set by the first story that ever named it.
create or replace function public.entity_grounding_upsert(
    p_canonical_name text,
    p_entity_class text,
    p_card jsonb,
    p_source text default 'model_knowledge'
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.entity_grounding (
        canonical_name, entity_class, card, source, expires_at
    ) values (
        p_canonical_name,
        p_entity_class,
        p_card,
        p_source,
        pg_catalog.now()
            + (public.entity_grounding_ttl_days(p_entity_class) || ' days')::interval
    )
    on conflict (cache_key) do update
    set canonical_name = excluded.canonical_name,
        entity_class = excluded.entity_class,
        card = excluded.card,
        source = excluded.source,
        expires_at = excluded.expires_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- entity_grounding_prune
-- ---------------------------------------------------------------------------
-- Expired rows are unreadable through the lookup but still occupy the unique
-- index, and an expired row is what stops a *new* card for the same entity
-- from being inserted as a fresh one. The upsert handles that on the write
-- path; this exists for the entities that go cold and are never asked for
-- again, which is most of the tail. Called by a scheduler, like
-- `refresh-subscription-grants`; nothing calls it yet.
create or replace function public.entity_grounding_prune()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_deleted integer;
begin
    delete from public.entity_grounding
    where expires_at < pg_catalog.now();
    get diagnostics v_deleted = row_count;
    return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
-- RLS on with no policy for `anon` or `authenticated`, which is the deny-all
-- posture: the table is written only by Edge Functions running as service_role,
-- and there is no user-facing read of it. A client that could read this cache
-- could enumerate which real people other users' private story ideas have
-- named -- the rows are shared across the whole corpus, and that is the whole
-- reason the class check above forbids private individuals from ever landing
-- here.
--
-- `service_role` bypasses RLS but is still subject to table privileges, and
-- those are two different gates -- the lesson 00042 paid for when `send-push`
-- could not read `push_tokens`. Both are granted explicitly.
alter table public.entity_grounding enable row level security;

revoke all on table public.entity_grounding from public, anon, authenticated;
grant select, insert, update, delete on table public.entity_grounding
    to service_role;

revoke all on function public.entity_grounding_lookup(text)
    from public, anon, authenticated;
grant execute on function public.entity_grounding_lookup(text) to service_role;

revoke all on function public.entity_grounding_upsert(text, text, jsonb, text)
    from public, anon, authenticated;
grant execute on function public.entity_grounding_upsert(text, text, jsonb, text)
    to service_role;

revoke all on function public.entity_grounding_prune()
    from public, anon, authenticated;
grant execute on function public.entity_grounding_prune() to service_role;

-- entity_grounding_key and entity_grounding_ttl_days stay executable by PUBLIC.
-- They are pure functions of their arguments, they read nothing, and the
-- generated `cache_key` column needs the key function to be callable in every
-- context that touches the table.

comment on function public.entity_grounding_lookup(text) is
  'Returns the cached grounding card for a canonical entity name, or null on a miss or an expired row. Expiry is applied here so no caller can forget it.';
comment on function public.entity_grounding_upsert(text, text, jsonb, text) is
  'Write-through cache insert for a validated grounding card. Last writer wins -- two generations racing on the same entity have each produced a valid card. Recomputes expires_at from the entity class on every write.';
comment on function public.entity_grounding_prune() is
  'Deletes expired grounding cards and returns the row count. For a scheduler; the upsert already replaces expired rows on the write path.';

-- The two constraints were added NOT VALID so the migration never has to scan
-- `stories`. Every existing row carries the '[]' default and satisfies them
-- trivially, so validating is cheap and leaves no unenforced contract behind.
alter table public.stories
  validate constraint stories_grounding_is_array;
alter table public.stories
  validate constraint stories_grounding_entities_is_array;
