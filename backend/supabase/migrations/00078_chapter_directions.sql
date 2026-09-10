-- Migration 00078: the directions a chapter was offered, and the one it took.
--
-- In `auto` mode nobody is asked which way the story goes: the model picks
-- (`_shared/direction-choice.ts`). That makes auto a MODE rather than a
-- silence only if the reader can later see which paths existed and which one
-- was taken, and surfacing those chips in the reader is a decided product
-- direction that is not built yet.
--
-- WHY BOTH COLUMNS, AND WHY NOW. The roads not taken are not recoverable after
-- the fact. Recording only the winner would make the future chip surface a
-- migration plus a backfill that cannot be written, because the options were
-- derived from a story state that has since moved on. Writing them at the
-- moment they existed costs one jsonb column and is the only time it is
-- possible.
--
-- `direction_chosen_by` is recorded too, so a surfaced chip can say honestly
-- how it was picked:
--
--   'reader'  -- interactive mode: a person tapped it or typed it.
--   'model'   -- auto mode: the direction model chose among the offered set.
--   'ranking' -- auto mode, but the choosing call failed or was not worth
--                making, so the highest-ranked option was taken. This is a
--                DIFFERENT fact from 'model' and collapsing the two would make
--                the surfaced chip a small lie.
--   null      -- nothing was derivable; the chapter was written with no
--                direction at all, which is what "Katha decides" means.
--
-- Nullable, with no default. Every chapter written before this migration has an
-- unknown answer rather than a known empty one, and a `'{}'::jsonb` default
-- would assert that those chapters were offered no directions -- which is not
-- something this migration can know.

alter table public.chapters
    add column if not exists directions_offered jsonb;

alter table public.chapters
    add column if not exists direction_chosen text;

alter table public.chapters
    add column if not exists direction_chosen_by text;

alter table public.chapters
    drop constraint if exists chapters_direction_chosen_by_check;

alter table public.chapters
    add constraint chapters_direction_chosen_by_check
    check (direction_chosen_by is null
           or direction_chosen_by in ('reader', 'model', 'ranking'));

comment on column public.chapters.directions_offered is
    'The direction chips that were on the table when this chapter was written, in offer order, as [{"id","prompt"}]. Recorded so the reader can later be shown which paths existed -- they are not recoverable after the fact, because they were derived from a story state that has since moved on.';

comment on column public.chapters.direction_chosen is
    'The direction this chapter was actually written from. Null means none was given, which is what "Katha decides" sends.';

comment on column public.chapters.direction_chosen_by is
    'Who chose: ''reader'' (interactive), ''model'' (auto, the direction model picked), ''ranking'' (auto, but the choosing call failed so the top-ranked option was taken). The last two are deliberately distinct -- collapsing them would make a surfaced chip claim a choice that was really a fallback.';
