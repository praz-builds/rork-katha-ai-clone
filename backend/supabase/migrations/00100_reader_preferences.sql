-- 00100: reader preferences -- the languages a reader speaks and their city.
--
-- Set on You ("Global preferences" -> "Languages and home") and read by the
-- server when a first chapter is written, where it becomes the prompt's
-- "Reader context" block (`buildReaderContextBlock`, story-prompts.ts). It is
-- cultural context, NOT an output language: the brief's `language` still
-- decides what the prose is written in.
-- `source-of-truth/STORY_PROMPT_SYSTEM.md` *Reader context* is the contract.
--
-- ## Why a table and not the device
--
-- Story world (the region preference) is device-local, because it is one id
-- from a closed list. A city is personal data: the security gate forbids PII
-- in AsyncStorage, and a preference that shapes every story should follow the
-- reader to a new phone. One row per account, keyed on the profile.
--
-- ## Who may read and write
--
-- No client role, in either direction. The `profile` edge function verifies
-- the JWT and calls `set_reader_preferences` as service role; the generation
-- functions read the row as service role, keyed on the verified user id. The
-- request body never names whose preferences to use.
--
-- ## Bounds
--
-- Up to three languages from a closed list of ISO 639 codes (the same ids as
-- `SPOKEN_LANGUAGES` in `_shared/reader-preferences.ts` and in the client).
-- The city is optional, at most 60 characters, trimmed, never blank, with
-- no control characters and no ASCII symbol other than . , ' ( ) -. The
-- endpoint applies the stricter rule (letters and marks in any script,
-- digits, spaces and that punctuation) and gives the specific message; the
-- CHECKs are the backstop that decides.
--
-- ## Account deletion
--
-- Profiles are tombstoned, not deleted (00070), so the foreign key's cascade
-- never fires. A trigger on the tombstoning update deletes the row, as 00098
-- does for app feedback: a city is exactly what 00070 refuses to keep beside
-- somebody who asked to be forgotten. A tombstoned account saves nothing.
--
-- Repo rule (00071): NULLIF, COALESCE, GREATEST and LEAST are parser
-- constructs, not `pg_catalog` functions. Under `set search_path = ''` every
-- real function is qualified and these four must NOT be.

create table if not exists public.reader_preferences (
    user_id uuid primary key references public.profiles(id) on delete cascade,
    spoken_languages text[] not null default '{}',
    home_place text,
    updated_at timestamptz not null default pg_catalog.now(),
    constraint reader_preferences_languages_count
        check (pg_catalog.cardinality(spoken_languages) <= 3),
    constraint reader_preferences_languages_known
        check (spoken_languages <@ array[
            'en', 'hi', 'bn', 'ta', 'te', 'mr', 'gu', 'kn', 'ml', 'pa',
            'ur', 'es', 'pt', 'fr', 'de', 'it', 'ar', 'fa', 'tr', 'ru',
            'zh', 'ja', 'ko', 'id', 'fil', 'vi', 'th', 'sw', 'yo', 'am'
        ]::text[]),
    constraint reader_preferences_home_place_shape
        check (
            home_place is null
            or (
                pg_catalog.char_length(home_place) between 1 and 60
                and home_place = pg_catalog.btrim(home_place)
                -- A denylist, not an allowlist: `[[:alnum:]]` depends on the
                -- database's locale and misses combining marks, so "पुणे"
                -- could pass the endpoint and fail here. The endpoint's
                -- Unicode allowlist is the strict rule; this refuses every
                -- ASCII symbol it does not allow, and control characters.
                and home_place !~ '[!"#$%&*+/:;<=>?@^_`{|}~\\[\]]'
                and home_place !~ '[[:cntrl:]]'
                and home_place !~ '\s\s'
            )
        )
);

comment on table public.reader_preferences is
    'Languages a reader speaks and their city (00100), from You -> Global preferences. Cultural context for the first chapter''s prompt; never an output language. Written only by set_reader_preferences as service role; no client role can read or write it. Deleted when the account is tombstoned.';

alter table public.reader_preferences enable row level security;
revoke all on table public.reader_preferences from public, anon, authenticated;
grant select, insert, update, delete on table public.reader_preferences to service_role;

/*
 * Replaces the row with exactly what was passed. An empty list and a null
 * place clear it -- the row is deleted rather than kept empty, so "has this
 * reader set anything" is "does a row exist".
 *
 * Invalid input raises (check constraint 23514): the edge function validated
 * first, so a raise here is a bug in that validation, not a user error.
 */
create or replace function public.set_reader_preferences(
    p_user_id uuid,
    p_spoken_languages text[],
    p_home_place text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_languages text[] := coalesce(p_spoken_languages, '{}'::text[]);
    v_place text := nullif(pg_catalog.btrim(p_home_place), '');
begin
    if p_user_id is null then
        raise exception 'user is required' using errcode = 'KTH01';
    end if;

    -- A deleted account can hold a valid token for a while; its row was
    -- erased at deletion and must not come back.
    if exists (
        select 1 from public.profiles
        where id = p_user_id and deleted_at is not null
    ) then
        return pg_catalog.jsonb_build_object('gone', true);
    end if;

    if pg_catalog.cardinality(v_languages) = 0 and v_place is null then
        delete from public.reader_preferences where user_id = p_user_id;
        return pg_catalog.jsonb_build_object('cleared', true);
    end if;

    insert into public.reader_preferences as rp
        (user_id, spoken_languages, home_place, updated_at)
    values (p_user_id, v_languages, v_place, pg_catalog.now())
    on conflict (user_id) do update
        set spoken_languages = excluded.spoken_languages,
            home_place = excluded.home_place,
            updated_at = excluded.updated_at;

    return pg_catalog.jsonb_build_object('saved', true);
end;
$$;

revoke all on function public.set_reader_preferences(uuid, text[], text)
    from public, anon, authenticated;
grant execute on function public.set_reader_preferences(uuid, text[], text)
    to service_role;

comment on function public.set_reader_preferences(uuid, text[], text) is
    'Service-only. Replaces the caller''s reader_preferences row; an empty list and a null place delete it. Returns gone for a tombstoned account.';

-- Account deletion erases the row. See the header.
create or replace function public.erase_reader_preferences_on_account_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    delete from public.reader_preferences where user_id = new.id;
    return new;
end;
$$;

revoke all on function public.erase_reader_preferences_on_account_deletion()
    from public, anon, authenticated;

drop trigger if exists erase_reader_preferences_on_account_deletion on public.profiles;
create trigger erase_reader_preferences_on_account_deletion
    after update of deleted_at on public.profiles
    for each row
    when (old.deleted_at is null and new.deleted_at is not null)
    execute function public.erase_reader_preferences_on_account_deletion();
