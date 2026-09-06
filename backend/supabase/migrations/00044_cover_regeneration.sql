-- Migration 00044: what a cover regeneration has to remember
--
-- `CREDITS_AND_PRICING.md` prices "Regenerate a cover you paid for" at
-- **0 — 1 free retry**, and `STORY_GENERATION_FLOW.md` §10.4 states the same
-- rule as "Regenerate: 1 free retry, then 1 ✦". That price is not expressible
-- against the schema as it stands: nothing on `stories` distinguishes a cover
-- nobody has re-rolled from one that has been re-rolled four times, so the
-- endpoint would have to charge everybody or nobody. `cover_regen_count` is the
-- missing fact.
--
-- Two columns, and both of them are counted in the same place for a reason.
--
--   cover_regen_count  how many regenerations have been *delivered*. It is the
--                      free-versus-paid discriminator: 0 means the next one is
--                      free, anything above it means the next one is 1 credit.
--
--   cover_attempt_count  how many regenerations have been *started*, delivered
--                      or not. This is the spend bound, and it is a different
--                      number from the one above on purpose -- see the ceiling
--                      note below.
--
--   cover_last_request_id  the request id of the most recent claim, so a
--                      retried request that already produced a cover replays it
--                      instead of buying a second one.
--
--   cover_prompt       the prompt the current cover was actually made from.
--                      A regeneration that re-sends the prompt that produced
--                      the cover the user is asking to replace is not a
--                      regeneration, it is the same request again. Storing what
--                      was sent is what lets the next attempt be told to vary
--                      from it. It is deliberately *not* the user's own note:
--                      the note is an input to the next prompt, this is the
--                      output that went to the provider.
--
-- Neither column is added to the narrow owner-update grant from 00015, for the
-- same reason `cover_status` was withheld in 00029: they are server-derived. A
-- client that could set `cover_regen_count` back to 0 would have an unlimited
-- supply of free covers, which is the whole of the price this migration exists
-- to make chargeable.

alter table public.stories
  add column if not exists cover_regen_count integer not null default 0,
  add column if not exists cover_attempt_count integer not null default 0,
  add column if not exists cover_last_request_id text,
  add column if not exists cover_prompt text;

comment on column public.stories.cover_regen_count is
  'Delivered cover regenerations. 0 means the next regeneration is the free retry; above 0 it costs 1 credit. Incremented only by finish_cover_regeneration, and only on success.';
comment on column public.stories.cover_attempt_count is
  'Cover regenerations started, delivered or not. Bounds provider spend per story; see COVER_ATTEMPT_LIMIT in claim_cover_regeneration.';
comment on column public.stories.cover_last_request_id is
  'Request id of the most recent claim. Makes the free regeneration path idempotent, which reserve_generation_operation only does for the paid one.';
comment on column public.stories.cover_prompt is
  'The image prompt the current cover was generated from, so a regeneration can vary from it rather than repeat it. Never user free text.';

-- ---------------------------------------------------------------------------
-- Why attempts are counted separately from deliveries
-- ---------------------------------------------------------------------------
-- Pricing counts deliveries, and it has to: a regeneration that produced no
-- image has given the writer nothing, so it costs nothing and does not spend
-- the free retry. That is the right rule and it is what CREDITS_AND_PRICING.md
-- means by "1 free retry".
--
-- On its own it is also an unmetered image budget. The caller controls whether
-- an attempt fails -- `prompt_note` is per-request free text that reaches the
-- provider -- so "make it fail" is a request anyone can send, and each failure
-- leaves `cover_regen_count` at 0, which means the next one is free again.
-- Every cycle spends real money on OPENAI_API_KEY or OPENROUTER_API_KEY, there
-- is no rate limiting in front of any Edge Function, and guest bootstrap makes
-- accounts free. Deliveries cannot be the bound because the failure case is the
-- one being abused.
--
-- So attempts are counted too, and the ceiling refuses the claim itself --
-- before any reservation and before any provider call.
--
-- The ceiling is 12 per story. A legitimate path is one free retry plus however
-- many paid ones the writer buys, and CREDITS_AND_PRICING.md section 13 treats
-- a cover-regeneration rate above 40% as evidence of a prompt problem rather
-- than of demand, so the expected number is close to one. Twelve is roughly an
-- order of magnitude above plausible use, it is reachable only by spending 11
-- credits when attempts succeed, and it caps the worst case -- three providers
-- times three safety rungs -- at 108 image requests for one story. Past it a
-- hostile caller must buy a whole new story at 3 credits to get another 12,
-- which is the point: the spend is bounded per unit of money spent, not per
-- unit of patience.
--
-- It is not reset by a delivered cover. A counter that reset on success would
-- restore the loop for anyone willing to let one attempt through.

-- No CHECK (cover_regen_count >= 0).
--
-- 00029 added `stories_cover_status_check` NOT VALID and validated it in a
-- separate file (00032), because ADD CONSTRAINT holds ACCESS EXCLUSIVE for its
-- scan and `stories` is hot. That two-file dance is the right shape when a
-- constraint is the only thing standing between the column and a bad value.
-- Here it is not: the column is `not null default 0`, the owner-update grant
-- cannot reach it, and the single writer below only ever adds one. A check
-- constraint would cost a table rewrite's worth of lock to restate an invariant
-- that has no way to be violated.

-- ---------------------------------------------------------------------------
-- claim_cover_regeneration
-- ---------------------------------------------------------------------------
-- Ownership, the staleness guard, the claim, and the price decision, in one
-- transaction under one lock.
--
-- Doing these as four round trips from the Edge Function is the obvious
-- implementation and it has a hole in the middle: two taps of Regenerate read
-- `cover_regen_count = 0` a few milliseconds apart, both conclude the retry is
-- free, and the user gets two covers for nothing. The advisory lock plus the
-- 'generating' claim closes that — the second caller either waits for the first
-- to commit and then reads a count of 0 with a fresh 'generating' claim in
-- front of it, or it arrives afterwards and reads the incremented count.
--
-- It returns everything the cover prompt is built from, so the caller does not
-- follow this with a second SELECT of the same row.
create or replace function public.claim_cover_regeneration(
    p_story_id uuid,
    p_user_id uuid,
    p_request_id text default null,
    p_stale_after interval default interval '10 minutes'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_story public.stories;
    v_attempt_limit constant integer := 12;
begin
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_story_id::text, 1)
    );

    select * into v_story
    from public.stories
    where id = p_story_id
    for update;

    if not found then
        return pg_catalog.jsonb_build_object('claimed', false, 'reason', 'not_found');
    end if;

    -- Ownership is checked here rather than trusted from the caller. This
    -- function is SECURITY DEFINER and reachable only by service_role, so it is
    -- the last gate before a user pays to change somebody else's story.
    if v_story.author_id is distinct from p_user_id then
        return pg_catalog.jsonb_build_object('claimed', false, 'reason', 'not_owner');
    end if;

    -- The same request id, against a cover that is already sitting there
    -- finished, is a retry of a call that succeeded -- a dropped response, a
    -- backgrounded app, a tapped-twice button. Handing back the cover it
    -- already bought is what idempotency means here.
    --
    -- `reserve_generation_operation` gives the paid path this for free, and
    -- gave the free path nothing: `request_id` was validated by the handler and
    -- then never used, so a replayed free regeneration ran the whole provider
    -- chain again. This is the half that was missing.
    if p_request_id is not null
       and v_story.cover_last_request_id = p_request_id
       and v_story.cover_status = 'ready'
       and v_story.cover_image_url is not null then
        return pg_catalog.jsonb_build_object(
            'claimed', false,
            'reason', 'replayed',
            'cover_image_url', v_story.cover_image_url,
            'cover_regen_count', v_story.cover_regen_count
        );
    end if;

    -- The spend bound. Before the reservation and before the provider, because
    -- the attempt this refuses is one that would have cost us money and the
    -- caller nothing.
    if v_story.cover_attempt_count >= v_attempt_limit then
        return pg_catalog.jsonb_build_object(
            'claimed', false,
            'reason', 'attempt_limit'
        );
    end if;

    -- A fresh 'generating' claim means another regeneration — or the original
    -- background media task — is in flight. Two providers writing the same
    -- storage key would leave the row pointing at whichever finished last, and
    -- the user would have paid for the one that lost. Past the staleness window
    -- the previous claim is assumed dead (see COVER_GENERATING_STALE_MS in
    -- media.ts) and this one takes the row.
    if v_story.cover_status = 'generating'
       and v_story.cover_started_at is not null
       and v_story.cover_started_at > pg_catalog.now() - p_stale_after then
        return pg_catalog.jsonb_build_object('claimed', false, 'reason', 'in_flight');
    end if;

    -- The attempt is counted here, in the same statement as the claim and under
    -- the same lock that decided the price. Counting it on the way out would
    -- leave every path that never reaches the exit -- a timeout, an evicted
    -- isolate, a caller that hangs up -- uncounted, which is the only kind of
    -- attempt worth counting twice.
    update public.stories
    set cover_status = 'generating',
        cover_started_at = pg_catalog.now(),
        cover_attempt_count = cover_attempt_count + 1,
        cover_last_request_id = coalesce(p_request_id, cover_last_request_id)
    where id = p_story_id;

    return pg_catalog.jsonb_build_object(
        'claimed', true,
        -- The status to put back if this attempt fails. Restoring it matters:
        -- a story that already had a good cover must not be left reading
        -- 'failed' because a *re*generation missed.
        'previous_cover_status', v_story.cover_status,
        'regen_count', v_story.cover_regen_count,
        'attempt_count', v_story.cover_attempt_count + 1,
        'attempts_remaining', v_attempt_limit - (v_story.cover_attempt_count + 1),
        -- 1 free retry, then 1 credit. Computed here so the price and the count
        -- it is derived from are read under the same lock.
        'requires_credit', v_story.cover_regen_count >= 1,
        'title', v_story.title,
        'primary_genre', v_story.primary_genre,
        'themes', pg_catalog.to_jsonb(coalesce(v_story.themes, '{}'::text[])),
        'where_and_when', v_story.where_and_when,
        'avoid', v_story.avoid,
        'cover_prompt', v_story.cover_prompt
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- finish_cover_regeneration
-- ---------------------------------------------------------------------------
-- The success path, and the only place the counter moves.
--
-- Incrementing on *delivery* rather than on attempt is what makes "1 free
-- retry" mean one free cover rather than one free failure. A regeneration that
-- exhausted every provider costs the user nothing and consumes nothing; the
-- credit, if one was reserved, is refunded by the caller on the same path.
--
-- `cover_regen_count + 1` is evaluated by the database against the row it is
-- writing, not by the caller against a value it read a minute ago, so a claim
-- that raced the counter cannot write it backwards.
--
-- The reservation is closed here too, and it has to be. `reserve_generation_operation`
-- leaves the row 'reserved', and the partial unique index
-- idx_generation_operations_active_chapter is on (story_id, chapter_number, kind)
-- WHERE status = 'reserved'. A delivered regeneration that never left that state
-- would hold the (story, 1, 'cover') slot forever, and the *next* regeneration -
-- a different request_id, so no replay - would come back KTH01 and be
-- unpurchasable. Closing it in the same statement as the counter means a
-- delivered cover and a settled reservation cannot disagree.
create or replace function public.finish_cover_regeneration(
    p_story_id uuid,
    p_user_id uuid,
    p_operation_id uuid,
    p_cover_url text,
    p_cover_prompt text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_count integer;
begin
    if p_operation_id is not null then
        update public.generation_operations
        set status = 'completed',
            updated_at = pg_catalog.now()
        where id = p_operation_id
          and user_id = p_user_id
          and status = 'reserved';
    end if;

    update public.stories
    set cover_image_url = p_cover_url,
        cover_prompt = p_cover_prompt,
        cover_status = 'ready',
        cover_regen_count = cover_regen_count + 1
    where id = p_story_id
      and author_id = p_user_id
    returning cover_regen_count into v_count;

    if not found then
        raise exception 'Story not found for cover regeneration';
    end if;

    return pg_catalog.jsonb_build_object(
        'cover_image_url', p_cover_url,
        'cover_status', 'ready',
        'cover_regen_count', v_count
    );
end;
$$;

-- The two-argument signature from this file's first revision is dropped rather
-- than left beside the new one: two overloads that differ only by a defaulted
-- argument make every PostgREST call ambiguous, and the old one has no
-- idempotency key and no attempt ceiling. Guarded so this file stays
-- re-runnable on a database that never saw it.
drop function if exists public.claim_cover_regeneration(uuid, uuid, interval);

revoke all on function public.claim_cover_regeneration(uuid, uuid, text, interval)
    from public, anon, authenticated;
grant execute on function public.claim_cover_regeneration(uuid, uuid, text, interval)
    to service_role;

revoke all on function public.finish_cover_regeneration(uuid, uuid, uuid, text, text)
    from public, anon, authenticated;
grant execute on function public.finish_cover_regeneration(uuid, uuid, uuid, text, text)
    to service_role;

comment on function public.claim_cover_regeneration(uuid, uuid, text, interval) is
  'Verifies ownership, replays a completed request id, refuses past the per-story attempt ceiling or while a claim is in flight, counts the attempt, marks the cover generating, and returns the prompt inputs plus whether this regeneration is the free retry or costs a credit.';
comment on function public.finish_cover_regeneration(uuid, uuid, uuid, text, text) is
  'Records a delivered cover regeneration: new URL, new prompt, cover_status ready, the counter that turns the next one into a paid action, and the reservation it settles.';
