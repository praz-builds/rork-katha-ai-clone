-- Migration 00042: threaded comments, voting, reporting, and author-blocking
--
-- 00001 defined `comments` as a flat, unthreaded list: one row per comment,
-- no parent, no votes, no way to report abuse, no way to stop seeing someone.
-- This migration adds the four pieces needed to make comments production
-- grade: threading, scored voting, polymorphic reports, and user-to-user
-- blocking. It does not touch `backend/supabase/functions/feed/index.ts`.
--
-- ---------------------------------------------------------------------------
-- Design decision 1: cascade delete vs. tombstone for `parent_id`
-- ---------------------------------------------------------------------------
-- `parent_id` is declared `references public.comments(id) on delete cascade`,
-- exactly as the task calls for, so a real SQL DELETE of a comment always
-- removes its whole subtree at the database level -- there is no dangling
-- `parent_id` left pointing at nothing.
--
-- But a real SQL DELETE is deliberately NOT the primary "delete my comment"
-- path a user exercises. Reddit's insight is correct: deleting a comment that
-- has replies should not erase the replies, because the replies still make
-- sense to the people who wrote them and to anyone reading the thread. So:
--
--   * `deleted_at timestamptz` is added as a soft-delete/tombstone marker.
--   * A user "deletes" their comment by UPDATE-ing `deleted_at`, not by
--     issuing DELETE. A `before update` trigger (`comments_scrub_on_delete`)
--     scrubs `content` to the literal string '[deleted]' the moment
--     `deleted_at` transitions from null to non-null, so the tombstone never
--     depends on the client remembering to redact the text itself.
--   * A tombstoned row stays visible under the same SELECT policy as any
--     other comment -- deliberately, and this was not the first design tried.
--     The first draft made the SELECT policy hide a soft-deleted comment once
--     it had no more replies (`deleted_at is null or reply_count > 0`), to
--     avoid leaving empty tombstones around forever. That draft does not
--     work, for a reason specific to Postgres RLS rather than to this schema:
--     an UPDATE's new row must satisfy the table's SELECT policy in addition
--     to the UPDATE policy's own WITH CHECK, so a policy that hides a row
--     once `deleted_at` is set makes the UPDATE that sets `deleted_at` fail
--     with "new row violates row-level security policy" for exactly the
--     comments a plain leaf-delete needs to hide -- a user could never
--     soft-delete their own reply-less comment. (Caught by the companion
--     test, which runs every one of these policies against a real Postgres
--     via PGlite; the leaf-hiding version failed outright rather than merely
--     producing a wrong answer.) So visibility does not depend on
--     `deleted_at` at all: the row is always readable, `content` is what
--     gets redacted, and "read all non-deleted comments" is satisfied in the
--     sense that matters -- nobody can read the original, removed text.
--   * Real DELETE (and therefore the `on delete cascade`) stays available --
--     the task requires an actual delete policy, and it is the right tool for
--     a leaf comment with no replies, or for admin/service-role moderation
--     purges -- but a client should prefer the soft-delete path for any
--     comment that might have replies, precisely because DELETE cascades and
--     a tombstone does not.
--
-- ---------------------------------------------------------------------------
-- Design decision 2: depth cap
-- ---------------------------------------------------------------------------
-- `depth` is a smallint, maintained by a `before insert` trigger
-- (`comments_set_depth`), constrained to the range [0, 7] -- eight levels of
-- nesting (a root comment at depth 0 through a reply at depth 7). This is a
-- deliberate, small, fixed ceiling for two reasons:
--
--   1. Denial of service: without a cap, nothing stops a client from posting
--      a reply-to-a-reply-to-a-reply chain thousands deep. Every one of those
--      levels is a row a thread-render has to walk, and an unbounded
--      self-reference is the textbook shape of a recursive-query DoS. Fixing
--      the cap at 8 means any subtree read is bounded by a small, known
--      constant instead of "however deep an attacker felt like typing."
--   2. This product is mobile-first (see AGENTS.md / project memory). On a
--      ~360-390dp-wide phone screen, each nesting level needs to indent the
--      reply so the reader can still tell whose reply is whose. At roughly
--      12-16dp of indent per level, 8 levels already consumes 100-130dp --
--      more than a third of the screen width -- before a single character of
--      the reply itself is drawn. Real comment UIs (Reddit's own apps
--      included) stop indenting and flatten well before that point. Eight is
--      already generous for what a phone screen can render usefully; there is
--      no product reason to allow more, and every additional level is pure
--      downside for the DoS concern above.
--
-- Depth is computed once at insert time from the parent's stored depth (O(1),
-- no recursion needed to compute it), and `parent_id` is immutable after
-- insert (`comments_prevent_reparent` trigger) specifically so a stored depth
-- is never invalidated by a later re-parent -- this product has no
-- "move this comment" UX, so forbidding it outright is free.
--
-- A reply must also share its parent's `story_id` (enforced in the same
-- trigger) so a thread can never straddle two stories.
--
-- ---------------------------------------------------------------------------
-- Design decision 3: one `content_reports` table, not two
-- ---------------------------------------------------------------------------
-- Reports can target either a story or a comment. Two genuinely different
-- shapes were considered:
--
--   (a) A fully generic polymorphic association: `target_type text,
--       target_id uuid`, no foreign key at all. Rejected: every other table
--       in this schema uses real foreign keys, and losing referential
--       integrity on the one table whose whole job is "point at something
--       that might get deleted out from under it" is exactly backwards.
--   (b) Two separate tables, `story_reports` and `comment_reports`. Rejected:
--       moderation has to review, dedupe, and status-track reports as one
--       queue ("show me everything pending, oldest first") regardless of
--       what was reported, and a duplicate-report constraint and a status
--       enum would otherwise have to be defined and kept in sync twice.
--
-- The chosen shape is a middle path: one `content_reports` table with two
-- *nullable* foreign-key columns, `story_id` and `comment_id`, plus a CHECK
-- that exactly one of them is set. Each column is a real `references` with
-- real cascade behavior -- nothing generic or untyped -- while moderation
-- still gets a single table to query, filter by `status`, and page through.
--
-- ---------------------------------------------------------------------------
-- Feed integration note (no edge function is edited by this migration)
-- ---------------------------------------------------------------------------
-- `user_blocks` records blocker/blocked pairs but enforces nothing by itself
-- -- a foreign key and a unique constraint do not filter a feed query.
-- `backend/supabase/functions/feed/index.ts` will need a follow-up change to
-- exclude stories (and, if/when comments render inline there, comments)
-- authored by anyone the requesting user has blocked, e.g. joining against
-- `user_blocks where blocker_id = auth.uid()` and excluding those
-- `blocked_id`s from `stories.author_id`. That function is intentionally left
-- untouched here.

-- ---------------------------------------------------------------------------
-- 1. Threading + tombstone + score columns on `comments`
-- ---------------------------------------------------------------------------

alter table public.comments
    add column if not exists parent_id uuid references public.comments(id) on delete cascade,
    add column if not exists depth smallint not null default 0,
    add column if not exists deleted_at timestamptz,
    add column if not exists score integer not null default 0,
    add column if not exists reply_count integer not null default 0;

alter table public.comments
    drop constraint if exists comments_depth_check;
alter table public.comments
    add constraint comments_depth_check check (depth >= 0 and depth <= 7);

alter table public.comments
    drop constraint if exists comments_parent_not_self;
alter table public.comments
    add constraint comments_parent_not_self check (parent_id is distinct from id);

-- Depth is derived from the parent, not supplied by the client (the INSERT
-- column grant below does not even include `depth`, but the trigger also
-- guards the case where a future grant change makes that column writable).
create or replace function public.comments_set_depth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_parent public.comments;
begin
    if new.parent_id is null then
        new.depth := 0;
        return new;
    end if;

    select * into v_parent
    from public.comments
    where id = new.parent_id;

    if not found then
        raise exception 'Parent comment % does not exist', new.parent_id;
    end if;

    if v_parent.story_id is distinct from new.story_id then
        raise exception 'A reply must belong to the same story as its parent comment';
    end if;

    if v_parent.depth >= 7 then
        raise exception 'Comment nesting exceeds the maximum depth of 8 levels';
    end if;

    new.depth := v_parent.depth + 1;
    return new;
end;
$$;

drop trigger if exists comments_set_depth_trigger on public.comments;
create trigger comments_set_depth_trigger
    before insert on public.comments
    for each row execute function public.comments_set_depth();

-- `parent_id` cannot change after insert. Nothing in the product moves a
-- comment to a different parent, and forbidding it outright means the stored
-- `depth` never needs to be recomputed for a subtree after the fact.
create or replace function public.comments_prevent_reparent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.parent_id is distinct from old.parent_id then
        raise exception 'A comment cannot be moved to a different parent after creation';
    end if;
    return new;
end;
$$;

drop trigger if exists comments_prevent_reparent_trigger on public.comments;
create trigger comments_prevent_reparent_trigger
    before update of parent_id on public.comments
    for each row execute function public.comments_prevent_reparent();

-- Keep `reply_count` on the parent in sync with its children. This is a
-- read-path optimization, the same reasoning as `comments.score` below: a
-- thread UI that wants to show "N replies" per comment should not run a
-- live `count(*)` against every parent on every render. It is not part of
-- the tombstone/visibility logic -- see decision 1 above for why visibility
-- cannot depend on a column the same UPDATE is trying to change.
create or replace function public.comments_maintain_reply_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        if new.parent_id is not null then
            update public.comments
            set reply_count = reply_count + 1
            where id = new.parent_id;
        end if;
        return new;
    elsif tg_op = 'DELETE' then
        if old.parent_id is not null then
            update public.comments
            set reply_count = reply_count - 1
            where id = old.parent_id;
        end if;
        return old;
    end if;
    return null;
end;
$$;

drop trigger if exists comments_maintain_reply_count_trigger on public.comments;
create trigger comments_maintain_reply_count_trigger
    after insert or delete on public.comments
    for each row execute function public.comments_maintain_reply_count();

-- The moment `deleted_at` is first set, scrub the content server-side so the
-- tombstone text is guaranteed regardless of what the client sent.
create or replace function public.comments_scrub_on_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.deleted_at is not null and old.deleted_at is null then
        new.content := '[deleted]';
    end if;
    return new;
end;
$$;

drop trigger if exists comments_scrub_on_delete_trigger on public.comments;
create trigger comments_scrub_on_delete_trigger
    before update of deleted_at on public.comments
    for each row execute function public.comments_scrub_on_delete();

-- ---------------------------------------------------------------------------
-- 2. `comment_votes` + the score trigger that keeps `comments.score` in sync
-- ---------------------------------------------------------------------------

create table if not exists public.comment_votes (
    user_id uuid not null references public.profiles(id) on delete cascade,
    comment_id uuid not null references public.comments(id) on delete cascade,
    value smallint not null check (value in (-1, 1)),
    created_at timestamptz not null default pg_catalog.now(),
    primary key (user_id, comment_id)
);

-- The primary key IS the double-vote guard: one row can exist per
-- (user_id, comment_id) pair, full stop, enforced by Postgres regardless of
-- what application code does or forgets to do. Changing a vote is an UPDATE
-- of `value` on the existing row (or an upsert), never a second INSERT.

create index if not exists comment_votes_comment_id_idx
    on public.comment_votes (comment_id);

-- Sorting a thread by score cannot be a live `count(*)` join -- that is an
-- aggregate over every vote on every comment on every read. `comments.score`
-- is the denormalized total, kept correct by this trigger on every vote
-- insert, value change, or removal.
create or replace function public.comment_votes_apply_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        update public.comments
        set score = score + new.value
        where id = new.comment_id;
        return new;
    elsif tg_op = 'UPDATE' then
        if new.value <> old.value then
            update public.comments
            set score = score + (new.value - old.value)
            where id = new.comment_id;
        end if;
        return new;
    elsif tg_op = 'DELETE' then
        update public.comments
        set score = score - old.value
        where id = old.comment_id;
        return old;
    end if;
    return null;
end;
$$;

drop trigger if exists comment_votes_apply_score_trigger on public.comment_votes;
create trigger comment_votes_apply_score_trigger
    after insert or update of value or delete on public.comment_votes
    for each row execute function public.comment_votes_apply_score();

-- ---------------------------------------------------------------------------
-- 3. `content_reports` -- polymorphic over story and comment (see decision 3)
-- ---------------------------------------------------------------------------

create table if not exists public.content_reports (
    id uuid primary key default gen_random_uuid(),
    reporter_id uuid not null references public.profiles(id) on delete cascade,
    story_id uuid references public.stories(id) on delete cascade,
    comment_id uuid references public.comments(id) on delete cascade,
    reason text not null check (reason in (
        'spam', 'harassment', 'hate_speech', 'sexual_content',
        'violence', 'self_harm', 'misinformation', 'other'
    )),
    details text check (details is null or pg_catalog.char_length(details) <= 2000),
    status text not null default 'pending' check (status in (
        'pending', 'reviewed', 'actioned', 'dismissed'
    )),
    created_at timestamptz not null default pg_catalog.now(),
    reviewed_at timestamptz,
    constraint content_reports_exactly_one_target check (
        (story_id is not null and comment_id is null)
        or (story_id is null and comment_id is not null)
    )
);

-- A reporter cannot file a second report against the same target. Two
-- partial unique indexes, one per target column, because a plain
-- `unique (reporter_id, story_id, comment_id)` would not stop a duplicate
-- report when one of the two target columns is null (NULL <> NULL in a
-- uniqueness comparison).
create unique index if not exists content_reports_reporter_story_uidx
    on public.content_reports (reporter_id, story_id)
    where comment_id is null;

create unique index if not exists content_reports_reporter_comment_uidx
    on public.content_reports (reporter_id, comment_id)
    where story_id is null;

create index if not exists content_reports_status_idx
    on public.content_reports (status, created_at);

create index if not exists content_reports_story_id_idx
    on public.content_reports (story_id)
    where story_id is not null;

create index if not exists content_reports_comment_id_idx
    on public.content_reports (comment_id)
    where comment_id is not null;

-- ---------------------------------------------------------------------------
-- 4. `user_blocks`
-- ---------------------------------------------------------------------------

create table if not exists public.user_blocks (
    blocker_id uuid not null references public.profiles(id) on delete cascade,
    blocked_id uuid not null references public.profiles(id) on delete cascade,
    created_at timestamptz not null default pg_catalog.now(),
    primary key (blocker_id, blocked_id),
    constraint user_blocks_no_self_block check (blocker_id <> blocked_id)
);

-- The primary key is the duplicate-block guard, same reasoning as
-- `comment_votes`. Reverse-direction lookup ("who has blocked this author",
-- useful for future abuse heuristics as well as the feed) needs its own
-- index because the primary key's leading column is `blocker_id`.
create index if not exists user_blocks_blocked_id_idx
    on public.user_blocks (blocked_id);

-- ---------------------------------------------------------------------------
-- 5. Indexes for the real read paths on `comments`
-- ---------------------------------------------------------------------------

-- Subtree read by parent, and sort-by-score within that subtree, share one
-- composite index (leftmost prefix covers a plain "children of X" lookup
-- too, so a separate `parent_id`-only index would be redundant).
create index if not exists comments_parent_id_score_idx
    on public.comments (parent_id, score desc);

-- Sort a story's top-level comments by score. `idx_comments_story` from
-- 00001 already covers "thread read by story" ordered by recency.
create index if not exists comments_story_id_score_idx
    on public.comments (story_id, score desc)
    where parent_id is null;

-- ---------------------------------------------------------------------------
-- 6. Row level security
-- ---------------------------------------------------------------------------

alter table public.comment_votes enable row level security;
alter table public.content_reports enable row level security;
alter table public.user_blocks enable row level security;

-- comments: the existing SELECT policy is deliberately left untouched.
-- The live one is NOT the one 00002 created -- 00005 ("secure_credit_
-- operations") already dropped "Comments are viewable by authenticated
-- users" and replaced it with "Accessible story comments are viewable",
-- which requires the parent story to be public/curated/owned by the reader.
-- Per decision 1 above, visibility does not gate on `deleted_at`: a
-- tombstoned comment stays exactly as visible as it always was, and the
-- only change on delete is that `content` reads back as '[deleted]'. So
-- there is nothing for this migration to add to the SELECT policy, and
-- touching it at all would risk the trap decision 1 describes -- a policy
-- that experimented with hiding rows on `deleted_at` broke the very UPDATE
-- that sets it (verified with the companion test against a real Postgres
-- via PGlite while writing this migration, not merely reasoned about).

-- comments: add update/delete for the comment's own author. Insert already
-- exists from 00005 ("Users can insert accessible story comments") and is
-- left as-is.
drop policy if exists "Users can update own comments" on public.comments;
create policy "Users can update own comments"
    on public.comments for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "Users can delete own comments" on public.comments;
create policy "Users can delete own comments"
    on public.comments for delete
    using (auth.uid() = user_id);

-- comment_votes: a user sees, casts, changes, and removes only their own vote.
create policy "Users can view own comment votes"
    on public.comment_votes for select
    using (auth.uid() = user_id);

create policy "Users can cast own comment votes"
    on public.comment_votes for insert
    with check (auth.uid() = user_id);

create policy "Users can change own comment votes"
    on public.comment_votes for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "Users can remove own comment votes"
    on public.comment_votes for delete
    using (auth.uid() = user_id);

-- content_reports: insert-only for the reporter. There is deliberately no
-- select/update/delete policy for `authenticated` at all, so a reporter
-- cannot read back their own report (or anyone else's) and cannot see or
-- change `status` -- moderation happens through the service role, which
-- bypasses RLS.
create policy "Users can file own content reports"
    on public.content_reports for insert
    with check (auth.uid() = reporter_id);

-- user_blocks: a user manages only their own block list.
create policy "Users can view own blocks"
    on public.user_blocks for select
    using (auth.uid() = blocker_id);

create policy "Users can create own blocks"
    on public.user_blocks for insert
    with check (auth.uid() = blocker_id);

create policy "Users can remove own blocks"
    on public.user_blocks for delete
    using (auth.uid() = blocker_id);

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------

-- comments: narrow the INSERT grant to the columns a client is actually
-- allowed to set. `depth` is trigger-derived, `score` is vote-trigger-derived,
-- and `deleted_at` only ever transitions via the dedicated update grant below
-- -- none of the three should be settable from an arbitrary INSERT payload.
revoke insert on public.comments from authenticated;
grant insert (user_id, story_id, chapter_id, parent_id, content)
    on public.comments to authenticated;

grant update (content, deleted_at) on public.comments to authenticated;
grant delete on public.comments to authenticated;

revoke all on table public.comment_votes from public, anon;
grant select, insert, delete on public.comment_votes to authenticated;
grant update (value) on public.comment_votes to authenticated;

-- Column-scoped, not table-wide: a table-level INSERT grant would let a
-- reporter set `status` or `reviewed_at` directly in their own INSERT
-- payload, which is exactly the write access the task says a reporter must
-- not have. Restricting the grant to the columns a report actually needs
-- from its filer means `status` can only ever start at its 'pending'
-- default and `reviewed_at` at null, regardless of what a client sends.
revoke all on table public.content_reports from public, anon;
grant insert (reporter_id, story_id, comment_id, reason, details)
    on public.content_reports to authenticated;

revoke all on table public.user_blocks from public, anon;
grant select, insert, delete on table public.user_blocks to authenticated;
