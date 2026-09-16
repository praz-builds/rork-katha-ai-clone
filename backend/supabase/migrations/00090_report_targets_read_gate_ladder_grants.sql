-- 00090: three findings from the security review of 00089, closed at the
-- database layer.
--
-- Every one of them is a case of the edge function being right and the table
-- underneath it being looser. The edge function is not the only way in:
-- `content_reports` carries a column-scoped INSERT grant to `authenticated`
-- and an `auth.uid() = reporter_id` policy, so a client with the anon key and
-- a session can POST straight to PostgREST and never run a line of
-- TypeScript. What that client can write is what this file decides.
--
--   1. REPORT TARGETS. 00089 widened `content_reports_reason_check` to the
--      UNION of the story reasons and the comment reasons, because one column
--      now serves two targets. The union accepts a comment filed as
--      `inappropriate_cover` (a comment has no cover) and a story filed as
--      `hate_speech` (a reason about a person, useless against a manuscript).
--      `comments/index.ts` refuses both; the table did not. It does now.
--      The details ceiling moves the same way: a story note is capped at
--      1,000 characters in the function (D13) and was capped at 2,000 here.
--
--   2. THE QUALIFYING READ. D9 pays a credit for feedback written by somebody
--      who actually read the story. The gate summed `story_reads.duration_seconds`
--      and asked for 120. That column is client-supplied -- `record-read`
--      bounds it 0..86400 and otherwise believes it -- so one POST with
--      `durationSeconds: 86400` was a qualifying read. The sum stays, and a
--      server-set clock is added underneath it.
--
--   3. `streak_ladder()` was the one function 00089 defined without the
--      `revoke ... / grant execute to service_role` pair every other function
--      in that file carries.
--
-- Nothing here changes a response body or a reason string. `not_read` is
-- still `not_read`, so no client copy moves.

-- ===========================================================================
-- 1. `content_reports`: the reason has to match the target
-- ===========================================================================
--
-- Story targets: `copyright`, `inappropriate_content`, `inappropriate_cover`,
-- `other`. Comment targets: `spam`, `harassment`, `hate_speech`,
-- `sexual_content`, `violence`, `self_harm`, `misinformation`, `other`.
-- `other` is the only overlap, and is deliberate -- both lists need an
-- escape hatch. The two lists are `STORY_REPORT_REASONS` and
-- `REPORT_REASONS` in `comments/index.ts`; if one moves, both move.
--
-- `content_reports_exactly_one_target` (00043) already guarantees exactly one
-- of the two id columns is non-null, so `story_id is not null` is a total
-- discriminator and the constraint needs no third branch.
--
-- ADDED CONDITIONALLY, AND NEVER AT THE COST OF THE DEPLOY. A check
-- constraint is validated against every existing row as it is added, so a
-- single historical row filed through some earlier shape of the API would
-- turn a security fix into a failed migration. The block below counts those
-- rows first: with none, the constraint is added and validated; with any, it
-- is added `not valid` and a warning names the count. `not valid` still binds
-- every INSERT and UPDATE from this moment on -- it only declines to re-read
-- the history -- so the hole closes either way, and the leftovers can be
-- reconciled and then
-- `alter table public.content_reports validate constraint content_reports_reason_check;`.

alter table public.content_reports
    drop constraint if exists content_reports_reason_check;

do $$
declare
    v_invalid bigint;
    v_check constant text :=
        'check ('
        || '(story_id is not null and reason in ('
        || '''copyright'', ''inappropriate_content'', ''inappropriate_cover'', ''other''))'
        || ' or (story_id is null and reason in ('
        || '''spam'', ''harassment'', ''hate_speech'', ''sexual_content'','
        || ' ''violence'', ''self_harm'', ''misinformation'', ''other''))'
        || ')';
begin
    select pg_catalog.count(*) into v_invalid
    from public.content_reports r
    where not (
        (r.story_id is not null and r.reason in (
            'copyright', 'inappropriate_content', 'inappropriate_cover', 'other'
        ))
        or (r.story_id is null and r.reason in (
            'spam', 'harassment', 'hate_speech', 'sexual_content',
            'violence', 'self_harm', 'misinformation', 'other'
        ))
    );

    if v_invalid > 0 then
        raise warning '00090: % existing content_reports row(s) carry a reason that does not match their target. The constraint is added NOT VALID, so every new report is checked and nothing historical is destroyed. Reconcile those rows, then: alter table public.content_reports validate constraint content_reports_reason_check;', v_invalid;
        execute 'alter table public.content_reports add constraint content_reports_reason_check '
            || v_check || ' not valid';
    else
        execute 'alter table public.content_reports add constraint content_reports_reason_check '
            || v_check;
    end if;
end;
$$;

comment on constraint content_reports_reason_check on public.content_reports is
    'The reason has to belong to the target it was filed against. Story: copyright, inappropriate_content, inappropriate_cover, other. Comment: spam, harassment, hate_speech, sexual_content, violence, self_harm, misinformation, other. Mirrors STORY_REPORT_REASONS and REPORT_REASONS in comments/index.ts, which a direct PostgREST insert never runs.';

-- The note's ceiling, per target. 1,000 for a story (D13, and what
-- `validateStoryReportDetails` enforces), 2,000 for a comment (what
-- `validateReportDetails` enforces). The column's own unnamed
-- `char_length(details) <= 2000` check from 00043 stays and remains the outer
-- bound; this is the inner, target-aware one.
--
-- The minimum is deliberately NOT mirrored. A comment report requires at
-- least 10 characters of explanation in the function, and that is a product
-- rule about what a moderator can act on, not a safety property -- a report
-- filed with a short note is a weaker report, not an exploit.

do $$
declare
    v_invalid bigint;
    v_check constant text :=
        'check (details is null or pg_catalog.char_length(details) <= '
        || 'case when story_id is not null then 1000 else 2000 end)';
begin
    select pg_catalog.count(*) into v_invalid
    from public.content_reports r
    where r.details is not null
      and pg_catalog.char_length(r.details) >
          (case when r.story_id is not null then 1000 else 2000 end);

    if v_invalid > 0 then
        raise warning '00090: % existing content_reports row(s) have details longer than their target allows. The constraint is added NOT VALID; reconcile and then validate it.', v_invalid;
        execute 'alter table public.content_reports add constraint content_reports_details_target_check '
            || v_check || ' not valid';
    else
        execute 'alter table public.content_reports add constraint content_reports_details_target_check '
            || v_check;
    end if;
end;
$$;

-- ===========================================================================
-- 2. `streak_ladder()`: the grants every other 00089 function has
-- ===========================================================================
--
-- It leaks nothing -- it is five hard-coded pairs, and the client renders
-- them from `profile_overview`. The revoke is consistency, not containment:
-- every other function in 00089 is service-role-only, and one exception is a
-- thing somebody has to re-derive the safety of later. The SECURITY DEFINER
-- callers (`touch_streak`, `profile_overview`) execute as the owner, so none
-- of them notices.

revoke all on function public.streak_ladder() from public, anon, authenticated;
grant execute on function public.streak_ladder() to service_role;

-- ===========================================================================
-- 3. The qualifying read has to have a server-set clock behind it
-- ===========================================================================
--
-- D9's rule is "two minutes on the story, before the comment". 00089
-- implemented it as `sum(duration_seconds) >= 120` over reads with
-- `read_at < created_at`, and every part of that except `read_at` comes from
-- the client. `record-read` accepts `durationSeconds` up to 86,400 and
-- writes it down; `read_at` it never touches, because `story_reads.read_at`
-- defaults to `now()` and `record_read` (00052) does not pass the column.
-- So the only value in the row a caller cannot choose is the timestamp.
--
-- The fix is to make the timestamp carry weight. The sum stays exactly as it
-- was -- a genuine reader clears it, and removing it would let a hundred
-- one-second reads qualify -- and a second, independent condition is added:
-- at least one read of this story by this user has to have been RECORDED at
-- least 60 seconds before the comment was written.
--
-- Why 60 and not 120. The window is not the reading time; it is the distance
-- between two server writes. A reader finishes a chapter, the client posts
-- the read, and the comment is typed afterwards -- which on any real device
-- is minutes, and the 40-character minimum on a claimable comment costs some
-- of them. 60 seconds is the smallest gap that a fabricated read cannot
-- produce, because the fabrication and the comment are the same round trip.
-- Asking for the full 120 would start refusing fast, genuine readers for no
-- extra safety: an attacker who is willing to wait 60 seconds is equally
-- willing to wait 120, so the number buys nothing above the point where a
-- same-instant forgery fails.
--
-- What this does NOT claim. It does not prove somebody read anything. A
-- patient attacker can post a read, wait a minute and comment. It removes the
-- one-request forgery, which is the only version of this worth an attacker's
-- time at one credit a claim, six a month.
--
-- The reason string stays `not_read`. The client's copy for this refusal does
-- not move, because the user-visible rule has not changed -- only the
-- evidence the server will accept for it.

create or replace function public.comment_credit_block_reason(
    p_user_id uuid,
    p_comment_id uuid
) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_comment public.comments;
    v_author_id uuid;
    v_day_start timestamptz := (pg_catalog.date_trunc('day', pg_catalog.now() at time zone 'UTC')) at time zone 'UTC';
    v_month_start timestamptz := (pg_catalog.date_trunc('month', pg_catalog.now() at time zone 'UTC')) at time zone 'UTC';
begin
    select * into v_comment from public.comments where id = p_comment_id;
    if not found or v_comment.user_id is distinct from p_user_id then
        return 'invalid';
    end if;

    if v_comment.credit_claimed_at is not null then
        return 'already_claimed';
    end if;

    if exists (select 1 from public.tester_accounts t where t.user_id = p_user_id) then
        return 'tester';
    end if;

    if v_comment.deleted_at is not null then
        return 'deleted';
    end if;

    if pg_catalog.char_length(pg_catalog.btrim(coalesce(v_comment.content, ''))) < 40 then
        return 'too_short';
    end if;

    select author_id into v_author_id from public.stories where id = v_comment.story_id;
    if v_author_id is null or v_author_id = p_user_id then
        return 'own_story';
    end if;

    if exists (
        select 1 from public.content_reports r
        where r.comment_id = p_comment_id and r.status = 'actioned'
    ) then
        return 'reported';
    end if;

    -- A qualifying read is two minutes on the story, recorded before the
    -- comment. `story_reads` carries one duration per chapter read, so the
    -- story's reads are summed: two minutes across three chapters is a read.
    -- `duration_seconds` is the client's number, so it is necessary and not
    -- sufficient; see the long note above this function.
    if coalesce((
        select pg_catalog.sum(sr.duration_seconds)
        from public.story_reads sr
        where sr.user_id = p_user_id
          and sr.story_id = v_comment.story_id
          and sr.read_at < v_comment.created_at
    ), 0) < 120 then
        return 'not_read';
    end if;

    -- ...and one of those reads has to have been written down by the server a
    -- full minute before the comment was. `read_at` defaults to `now()` and
    -- no caller sets it, which is what makes this the one part of the
    -- evidence a forged request cannot choose.
    if not exists (
        select 1
        from public.story_reads sr
        where sr.user_id = p_user_id
          and sr.story_id = v_comment.story_id
          and sr.read_at <= v_comment.created_at - interval '60 seconds'
    ) then
        return 'not_read';
    end if;

    -- The caps are read from the ledger, not from comments, so deleting a
    -- claimed comment never resets them.
    if exists (
        select 1 from public.credit_ledger l
        where l.user_id = p_user_id
          and l.reason = 'feedback'
          and l.reference_id = v_comment.story_id::text
    ) then
        return 'story_cap';
    end if;

    if exists (
        select 1 from public.credit_ledger l
        where l.user_id = p_user_id
          and l.reason = 'feedback'
          and l.created_at >= v_day_start
    ) then
        return 'daily_cap';
    end if;

    if (
        select pg_catalog.count(*) from public.credit_ledger l
        where l.user_id = p_user_id
          and l.reason = 'feedback'
          and l.created_at >= v_month_start
    ) >= 6 then
        return 'monthly_cap';
    end if;

    return null;
end;
$$;

comment on function public.comment_credit_block_reason(uuid, uuid) is
    'Why this comment cannot be claimed for a feedback credit, or null. The read gate needs both: 120 seconds of client-reported duration across the story, and at least one read whose server-set read_at is 60 seconds older than the comment. Both refusals report not_read.';

revoke all on function public.comment_credit_block_reason(uuid, uuid)
    from public, anon, authenticated;
grant execute on function public.comment_credit_block_reason(uuid, uuid) to service_role;

create index if not exists idx_story_reads_user_story_read_at
    on public.story_reads (user_id, story_id, read_at);
