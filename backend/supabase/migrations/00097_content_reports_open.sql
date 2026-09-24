-- Migration 00097: the report queue somebody can actually work through.
--
-- `content_reports` (00043, reasons widened in 00089/00090) has taken reports
-- from the story page, the reader's ⋮ menu and every comment since
-- 2026-09-16. Nothing reads them. The table is insert-only for its filers and
-- has no view, no owner and no process, so every report so far has been a
-- promise to the reporter ("our team will take a look") that nobody was in a
-- position to keep. Play's User Generated Content policy asks for action on
-- reports, not just intake.
--
-- This is the read side, and only the read side:
--
--   * `public.content_reports_open` -- every UNRESOLVED report (`pending` or
--     `reviewed`; `actioned` and `dismissed` are closed), newest first, with
--     what a moderator needs to decide without a second query: the story's
--     title and visibility, the comment's text, who wrote the thing reported
--     (`reported_user_id`, the person a block or removal would act on), who
--     reported it, and how many open reports that same target has
--     (`open_reports_on_target`), so a pile-on is visible at a glance.
--
--   * It is readable by `service_role` and by the dashboard's own role, and by
--     nobody else. `security_invoker` means the view is exactly as powerful as
--     whoever queries it, so it can never become a way around the table's
--     own grants: a reporter still cannot read reports back, their own or
--     anyone else's.
--
-- `service_role` gets SELECT on `content_reports` for the first time. 00012
-- recorded that this project has no blanket default privileges, so a table
-- created after it (00043 created this one) is unreadable by the service
-- client until something grants it -- the same 42501 00063 fixed for
-- `user_blocks`. SELECT only: resolving a report is an UPDATE of `status` and
-- `reviewed_at`, run from the SQL editor by whoever owns the queue, and
-- documented in `backend/MONITORING.md`. No write path is added here.
--
-- ORDER BY inside a view is not a guarantee a caller can rely on through
-- further joins or filters, so the documented query orders explicitly too.

create or replace view public.content_reports_open
with (security_invoker = true)
as
select
    r.id as report_id,
    r.created_at as reported_at,
    r.status,
    case when r.comment_id is not null then 'comment' else 'story' end
        as target_type,
    r.reason,
    r.details,
    coalesce(c.user_id, s.author_id) as reported_user_id,
    coalesce(comment_author.username, story_author.username)
        as reported_username,
    coalesce(r.story_id, c.story_id) as story_id,
    s.title as story_title,
    s.author_id as story_author_id,
    story_author.username as story_author_username,
    s.is_public as story_is_public,
    s.is_curated as story_is_curated,
    r.comment_id,
    c.user_id as comment_author_id,
    comment_author.username as comment_author_username,
    pg_catalog.left(c.content, 500) as comment_excerpt,
    c.deleted_at as comment_deleted_at,
    r.reporter_id,
    reporter.username as reporter_username,
    pg_catalog.count(*) over (partition by r.story_id, r.comment_id)
        as open_reports_on_target
from public.content_reports r
left join public.comments c on c.id = r.comment_id
left join public.stories s on s.id = coalesce(r.story_id, c.story_id)
left join public.profiles story_author on story_author.id = s.author_id
left join public.profiles comment_author on comment_author.id = c.user_id
left join public.profiles reporter on reporter.id = r.reporter_id
where r.status in ('pending', 'reviewed')
order by r.created_at desc;

comment on view public.content_reports_open is
    'Unresolved content reports (pending or reviewed), newest first, with story, comment and author context. service_role and the dashboard only. Resolve with the UPDATE documented in backend/MONITORING.md.';

revoke all on table public.content_reports_open from public, anon, authenticated;
grant select on table public.content_reports_open to service_role;
grant select on table public.content_reports to service_role;
