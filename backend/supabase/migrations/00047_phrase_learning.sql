-- Migration 00047: phrase learning data model
--
-- Readers can save useful English phrases from stories, practise them later,
-- and feed the reusable corpus back into future story prompts. The corpus is
-- shared; saved phrases and practice schedules are owned by one reader.

create or replace function public.phrase_normalize_key(p_phrase text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(
            replace(
              replace(
                replace(
                  replace(
                    replace(
                      replace(
                        replace(
                          replace(
                            replace(
                              replace(
                                replace(coalesce(p_phrase, ''), '’', ''''),
                                '‘',
                                ''''
                              ),
                              'ʼ',
                              ''''
                            ),
                            '′',
                            ''''
                          ),
                          '“',
                          '"'
                        ),
                        '”',
                        '"'
                      ),
                      '″',
                      '"'
                    ),
                    '–',
                    ' '
                  ),
                  '—',
                  ' '
                ),
                '‑',
                ' '
              ),
              '―',
              ' '
            )
          ),
          '[^[:alnum:]''[:space:]]+',
          ' ',
          'g'
        ),
        '\s+',
        ' ',
        'g'
      ),
      '^''+|''+$',
      '',
      'g'
    )
  );
$$;

create or replace function public.phrase_corpus_is_allowed(p_phrase text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
    v_key text := public.phrase_normalize_key(p_phrase);
    v_words text[];
    v_word text;
    v_banned_words constant text[] := array[
      'delve','tapestry','testament','pivotal','underscore','landscape',
      'foster','beacon','undeniably','multifaceted','nuanced','intricate',
      'commendable','meticulous','endeavor','realm','paradigm','synergy',
      'ecosystem','framework','robust','streamline','leverage','harness',
      'utilize','embark','unravel','comprehensive','holistic','unprecedented',
      'transformative','groundbreaking','innovative','enhance','crucial',
      'furthermore','moreover','consequently','bustling','labyrinth',
      'crucible','ministrations'
    ];
    v_banned_phrases constant text[] := array[
      'it''s not x it''s y','it is important to note',
      'it is worth mentioning','in today''s world','at the end of the day',
      'one of the most','when it comes to','at its core',
      'no discussion would be complete without','in this story','overall',
      'in summary','in conclusion','little did they know',
      'stands as a testament','plays a vital role','rich cultural heritage',
      'enduring legacy','a shiver ran down','a wave of emotion washed over',
      'the weight of','time seemed to stand still','their eyes locked',
      'heart pounding in','heart hammered against','breath caught in',
      'let out a breath didn''t know was holding','couldn''t help but',
      'voice barely above a whisper','etched with','gaze softened',
      'sent a chill through','furrowed brow','jaw tightened',
      'steeled themselves','squared their shoulders','eyes widened',
      'eyes sparkling','knot in stomach','pit in stomach','air was thick with'
    ];
begin
    if v_key = '' then
        return false;
    end if;

    v_words := regexp_split_to_array(v_key, '\s+');
    foreach v_word in array v_words loop
        if v_word = any(v_banned_words) then
            return false;
        end if;
    end loop;

    return not (v_key = any(v_banned_phrases));
end;
$$;

create table if not exists public.phrase_corpus (
    id uuid primary key default gen_random_uuid(),
    phrase_text text not null,
    phrase_key text not null,
    register text not null check (
        register in ('idiom', 'collocation', 'phrasal_verb', 'everyday')
    ),
    cefr text not null check (cefr in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
    literal_gloss text not null,
    example_sentence text not null,
    language text not null default 'English',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint phrase_corpus_phrase_text_present check (
        length(btrim(phrase_text)) between 1 and 160
    ),
    constraint phrase_corpus_phrase_key_matches check (
        phrase_key = public.phrase_normalize_key(phrase_text)
    ),
    constraint phrase_corpus_language_present check (
        length(btrim(language)) between 2 and 40
    ),
    constraint phrase_corpus_literal_gloss_present check (
        length(btrim(literal_gloss)) between 1 and 400
    ),
    constraint phrase_corpus_example_sentence_present check (
        length(btrim(example_sentence)) between 1 and 500
    ),
    constraint phrase_corpus_not_banned check (
        public.phrase_corpus_is_allowed(phrase_text)
    ),
    unique (phrase_key, language)
);

create table if not exists public.saved_phrases (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    phrase_id uuid references public.phrase_corpus(id) on delete set null,
    phrase_text text not null,
    phrase_key text not null,
    language text not null default 'English',
    story_id uuid not null references public.stories(id) on delete cascade,
    chapter_id uuid not null references public.chapters(id) on delete cascade,
    sentence text not null,
    saved_at timestamptz not null default now(),
    constraint saved_phrases_phrase_present check (
        length(btrim(phrase_text)) between 1 and 160
    ),
    constraint saved_phrases_phrase_key_matches check (
        phrase_key = public.phrase_normalize_key(phrase_text)
    ),
    constraint saved_phrases_sentence_present check (
        length(btrim(sentence)) between 1 and 600
    ),
    unique (user_id, language, phrase_key)
);

create or replace function public.saved_phrases_require_chapter_story_match()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not exists (
        select 1 from public.chapters
        where id = new.chapter_id and story_id = new.story_id
    ) then
        raise exception using errcode = 'KTH05', message = 'Chapter not found for story';
    end if;
    return new;
end;
$$;

drop trigger if exists saved_phrases_require_chapter_story_match_trigger
    on public.saved_phrases;
create trigger saved_phrases_require_chapter_story_match_trigger
    before insert or update of story_id, chapter_id on public.saved_phrases
    for each row execute function public.saved_phrases_require_chapter_story_match();

create table if not exists public.phrase_practice (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    saved_phrase_id uuid not null references public.saved_phrases(id) on delete cascade,
    attempted_at timestamptz,
    outcome text check (outcome in ('again', 'hard', 'good', 'easy')),
    interval_days integer not null default 0 check (interval_days >= 0),
    ease numeric(4,2) not null default 2.50 check (ease >= 1.30 and ease <= 3.50),
    due_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, saved_phrase_id)
);

create index if not exists phrase_corpus_language_key_idx
    on public.phrase_corpus (language, phrase_key);

create index if not exists saved_phrases_user_saved_at_idx
    on public.saved_phrases (user_id, saved_at desc);

create index if not exists phrase_practice_due_idx
    on public.phrase_practice (user_id, due_at asc, saved_phrase_id);

alter table public.phrase_corpus enable row level security;
alter table public.saved_phrases enable row level security;
alter table public.phrase_practice enable row level security;

create policy "Authenticated users can read phrase corpus"
    on public.phrase_corpus for select
    to authenticated
    using (true);

create policy "Users can read own saved phrases"
    on public.saved_phrases for select
    using (auth.uid() = user_id);

create policy "Users can save own phrases"
    on public.saved_phrases for insert
    with check (auth.uid() = user_id);

create policy "Users can update own saved phrases"
    on public.saved_phrases for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "Users can delete own saved phrases"
    on public.saved_phrases for delete
    using (auth.uid() = user_id);

create policy "Users can read own phrase practice"
    on public.phrase_practice for select
    using (auth.uid() = user_id);

create policy "Users can create own phrase practice"
    on public.phrase_practice for insert
    with check (auth.uid() = user_id);

create policy "Users can update own phrase practice"
    on public.phrase_practice for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

revoke all on table public.phrase_corpus from public, anon;
grant select on table public.phrase_corpus to authenticated;
grant select, insert, update, delete on table public.phrase_corpus to service_role;

revoke all on table public.saved_phrases from public, anon;
grant select, insert, update, delete on table public.saved_phrases to authenticated;

revoke all on table public.phrase_practice from public, anon;
grant select, insert, update on table public.phrase_practice to authenticated;

create or replace function public.save_phrase(
    p_user_id uuid,
    p_phrase text,
    p_story_id uuid,
    p_chapter_id uuid,
    p_sentence text
)
returns public.saved_phrases
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_phrase text := btrim(coalesce(p_phrase, ''));
    v_sentence text := btrim(coalesce(p_sentence, ''));
    v_key text := public.phrase_normalize_key(v_phrase);
    v_language text := 'English';
    v_corpus_id uuid;
    v_row public.saved_phrases;
begin
    if auth.uid() is distinct from p_user_id then
        raise exception using errcode = 'KTH01', message = 'Unauthorized';
    end if;
    if v_phrase = '' or length(v_phrase) > 160 then
        raise exception using errcode = 'KTH02', message = 'Invalid phrase';
    end if;
    if v_key = '' then
        raise exception using errcode = 'KTH02', message = 'Invalid phrase';
    end if;
    if v_sentence = '' or length(v_sentence) > 600 then
        raise exception using errcode = 'KTH03', message = 'Invalid sentence';
    end if;
    if not exists (
        select 1
        from public.stories s
        where s.id = p_story_id
          and (s.is_public = true or s.is_curated = true or s.author_id = p_user_id)
    ) then
        raise exception using errcode = 'KTH04', message = 'Story not found';
    end if;
    if not exists (
        select 1 from public.chapters c
        where c.id = p_chapter_id and c.story_id = p_story_id
    ) then
        raise exception using errcode = 'KTH05', message = 'Chapter not found';
    end if;

    select id into v_corpus_id
    from public.phrase_corpus
    where phrase_key = v_key and language = v_language;

    insert into public.saved_phrases (
        user_id, phrase_id, phrase_text, phrase_key, language,
        story_id, chapter_id, sentence
    )
    values (
        p_user_id, v_corpus_id, v_phrase, v_key, v_language,
        p_story_id, p_chapter_id, v_sentence
    )
    on conflict (user_id, language, phrase_key) do update
    set phrase_id = coalesce(excluded.phrase_id, public.saved_phrases.phrase_id),
        story_id = excluded.story_id,
        chapter_id = excluded.chapter_id,
        sentence = excluded.sentence
    returning * into v_row;

    insert into public.phrase_practice (user_id, saved_phrase_id)
    values (p_user_id, v_row.id)
    on conflict (user_id, saved_phrase_id) do nothing;

    return v_row;
end;
$$;

create or replace function public.record_phrase_practice(
    p_user_id uuid,
    p_saved_phrase_id uuid,
    p_outcome text
)
returns public.phrase_practice
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_existing public.phrase_practice;
    v_interval integer;
    v_ease numeric(4,2);
    v_row public.phrase_practice;
begin
    if auth.uid() is distinct from p_user_id then
        raise exception using errcode = 'KTH01', message = 'Unauthorized';
    end if;
    if p_outcome not in ('again', 'hard', 'good', 'easy') then
        raise exception using errcode = 'KTH02', message = 'Invalid outcome';
    end if;
    if not exists (
        select 1 from public.saved_phrases
        where id = p_saved_phrase_id and user_id = p_user_id
    ) then
        raise exception using errcode = 'KTH03', message = 'Phrase not found';
    end if;

    select * into v_existing
    from public.phrase_practice
    where user_id = p_user_id and saved_phrase_id = p_saved_phrase_id
    for update;

    if not found then
        insert into public.phrase_practice (user_id, saved_phrase_id)
        values (p_user_id, p_saved_phrase_id)
        returning * into v_existing;
    end if;

    v_ease := greatest(
        1.30,
        least(
            3.50,
            v_existing.ease + case p_outcome
                when 'again' then -0.30
                when 'hard' then -0.15
                when 'easy' then 0.15
                else 0
            end
        )
    );

    v_interval := case p_outcome
        when 'again' then 0
        when 'hard' then greatest(1, ceil(greatest(v_existing.interval_days, 1) * 1.2)::int)
        when 'good' then case
            when v_existing.interval_days = 0 then 1
            else ceil(v_existing.interval_days * v_ease)::int
        end
        when 'easy' then case
            when v_existing.interval_days = 0 then 4
            else ceil(v_existing.interval_days * v_ease * 1.3)::int
        end
    end;

    update public.phrase_practice
    set attempted_at = now(),
        outcome = p_outcome,
        interval_days = v_interval,
        ease = v_ease,
        due_at = now() + make_interval(days => v_interval),
        updated_at = now()
    where id = v_existing.id
    returning * into v_row;

    return v_row;
end;
$$;

revoke all on function public.phrase_normalize_key(text) from public;
grant execute on function public.phrase_normalize_key(text) to authenticated, service_role;

revoke all on function public.phrase_corpus_is_allowed(text) from public;
grant execute on function public.phrase_corpus_is_allowed(text) to service_role;

revoke all on function public.save_phrase(uuid, text, uuid, uuid, text) from public;
grant execute on function public.save_phrase(uuid, text, uuid, uuid, text) to authenticated;

revoke all on function public.record_phrase_practice(uuid, uuid, text) from public;
grant execute on function public.record_phrase_practice(uuid, uuid, text) to authenticated;
