-- Migration 00027: contracts for the story-creation flow rebuild
--
-- Adds the columns and operation kinds that `source-of-truth/STORY_GENERATION_FLOW.md`
-- requires, and nothing else. No behaviour changes: every column is nullable or
-- defaulted to today's behaviour, and the widened constraints only ever accept
-- more than they did before.
--
-- The flow document claimed no migration was required. That was wrong: there is
-- nowhere to store chapter art, character portraits, the brief fields, or the
-- planned length, and every paid image would be charged outside the idempotency
-- and auto-refund machinery that makes text generation safe.

-- ---------------------------------------------------------------------------
-- 1. Chapter art
-- ---------------------------------------------------------------------------
-- Chapter 1's image is the story's cover and is also a chapter image. Keeping
-- both pointers is deliberate: stories.cover_image_url is what the shelf reads,
-- chapters.image_url is what the reader reads, and for chapter 1 they are the
-- same URL. A story whose cover was uploaded rather than generated has a
-- cover_image_url and no chapters.image_url on chapter 1.

ALTER TABLE public.chapters
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS image_prompt text;

COMMENT ON COLUMN public.chapters.image_url IS
  'Generated illustration for this chapter. Chapter 1''s is compulsory and is also the story cover.';
COMMENT ON COLUMN public.chapters.image_prompt IS
  'The prompt that produced image_url, retained so a regeneration can vary from it rather than repeat it.';

-- ---------------------------------------------------------------------------
-- 2. Character portraits
-- ---------------------------------------------------------------------------

ALTER TABLE public.characters
  ADD COLUMN IF NOT EXISTS portrait_url text;

COMMENT ON COLUMN public.characters.portrait_url IS
  'Portrait generated from appearance + description at 1024x1024 low. One credit covers the whole cast, not one per character.';

-- ---------------------------------------------------------------------------
-- 3. The brief
-- ---------------------------------------------------------------------------
-- planned_chapter_count already exists (migration 00003) and has been unused.
-- It becomes the planned length that drives pacing and finale derivation.

ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS where_and_when text,
  ADD COLUMN IF NOT EXISTS moments text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS story_values text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS writing_style text,
  ADD COLUMN IF NOT EXISTS avoid text,
  ADD COLUMN IF NOT EXISTS chapter_length text NOT NULL DEFAULT 'standard'
    CHECK (chapter_length IN ('short', 'standard', 'long')),
  ADD COLUMN IF NOT EXISTS illustrate_chapters boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.stories.where_and_when IS
  'World and era, inferred from the idea and editable as a chip. Feeds the story prompt and the cover prompt.';
COMMENT ON COLUMN public.stories.moments IS
  'Beats the user asked for, capped in validation.ts. One entry is one schedulable beat.';
COMMENT ON COLUMN public.stories.story_values IS
  'Kids mode only: what the story teaches. Named story_values because "values" is reserved in SQL.';
COMMENT ON COLUMN public.stories.illustrate_chapters IS
  'Whether chapters 2..N get art at 1 credit each. Chapter 1 is compulsory regardless and is not governed by this flag.';

-- planned_chapter_count is now a contract, not a free integer. Existing rows may
-- hold anything (the column has never been written), so this is added NOT VALID
-- and validated in 00028 rather than scanning here.
ALTER TABLE public.stories
  DROP CONSTRAINT IF EXISTS stories_planned_chapter_count_check;

ALTER TABLE public.stories
  ADD CONSTRAINT stories_planned_chapter_count_check
  CHECK (planned_chapter_count IS NULL OR planned_chapter_count IN (3, 7, 15))
  NOT VALID;

-- ---------------------------------------------------------------------------
-- 4. Operation kinds for paid images
-- ---------------------------------------------------------------------------
-- Every paid AI action must reserve an operation, or it is charged outside the
-- idempotency and auto-refund path. Today only text can: kind is constrained to
-- ('story', 'continuation'), so a cover, a chapter illustration or a cast would
-- have to be charged some other way.
--
-- The new constraint is strictly wider than the old one, so every existing row
-- already satisfies it and validation cannot fail. That is why it is added
-- validated here rather than split across two migrations the way 00010/00011
-- split their narrowing constraints.

ALTER TABLE public.generation_operations
  DROP CONSTRAINT IF EXISTS generation_operations_kind_check;

ALTER TABLE public.generation_operations
  ADD CONSTRAINT generation_operations_kind_check
  CHECK (kind IN ('story', 'continuation', 'cover', 'chapter_art', 'characters'));

-- The active-reservation index was unique on (story_id, chapter_number), which
-- means a chapter's text and that same chapter's art could never be reserved at
-- the same time -- the second insert would raise KTH01. The sequential flow does
-- not hit this today, but the constraint encodes "one paid action per chapter",
-- which is no longer true. Widening it to include kind keeps the protection that
-- matters (no duplicate reservation of the same action) and drops the one that
-- does not.
DROP INDEX IF EXISTS public.idx_generation_operations_active_chapter;

CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_operations_active_chapter
  ON public.generation_operations(story_id, chapter_number, kind)
  WHERE status = 'reserved';

-- ---------------------------------------------------------------------------
-- 5. reserve_generation_operation accepts the new kinds
-- ---------------------------------------------------------------------------
-- Only the kind guard changes. Everything else -- the advisory locks, the
-- replay path, the KTH01 duplicate signal, the single-credit deduction -- is
-- reproduced exactly as it stands in 00005 so this migration is a guard change
-- and not a rewrite.

CREATE OR REPLACE FUNCTION public.reserve_generation_operation(
    p_user_id uuid,
    p_request_id text,
    p_story_id uuid,
    p_chapter_number integer,
    p_kind text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
declare
    v_operation public.generation_operations;
    v_balance integer;
begin
    if p_request_id is null
       or pg_catalog.btrim(p_request_id) = ''
       or pg_catalog.char_length(p_request_id) > 128 then
        raise exception 'Invalid generation request ID';
    end if;

    if p_chapter_number <= 0
       or p_kind not in ('story', 'continuation', 'cover', 'chapter_art', 'characters') then
        raise exception 'Invalid generation operation';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_story_id::text, 1)
    );

    select *
    into v_operation
    from public.generation_operations
    where user_id = p_user_id
      and request_id = p_request_id
    order by created_at desc, id desc
    limit 1;

    if found then
        select balance_after
        into v_balance
        from public.credit_ledger
        where user_id = p_user_id
        order by created_at desc, id desc
        limit 1;

        return pg_catalog.jsonb_build_object(
            'id', v_operation.id,
            'story_id', v_operation.story_id,
            'chapter_number', v_operation.chapter_number,
            'status', v_operation.status,
            'result_chapter_id', v_operation.result_chapter_id,
            'replayed', true,
            'balance', coalesce(v_balance, 0)
        );
    end if;

    begin
        insert into public.generation_operations (
            user_id,
            request_id,
            story_id,
            chapter_number,
            kind
        ) values (
            p_user_id,
            p_request_id,
            p_story_id,
            p_chapter_number,
            p_kind
        ) returning * into v_operation;
    exception
        when unique_violation then
            raise exception using
                errcode = 'KTH01',
                message = 'Generation chapter already reserved';
    end;

    v_balance := public.deduct_credit(
        p_user_id,
        1,
        'generation',
        v_operation.id::text,
        'generation:' || v_operation.id::text
    );

    return pg_catalog.jsonb_build_object(
        'id', v_operation.id,
        'story_id', v_operation.story_id,
        'chapter_number', v_operation.chapter_number,
        'status', v_operation.status,
        'result_chapter_id', v_operation.result_chapter_id,
        'replayed', false,
        'balance', coalesce(v_balance, 0)
    );
end;
$$;

REVOKE ALL ON FUNCTION public.reserve_generation_operation(uuid, text, uuid, integer, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_generation_operation(uuid, text, uuid, integer, text) TO service_role;
