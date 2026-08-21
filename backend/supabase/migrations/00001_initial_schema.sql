-- Story Generator App — Initial Schema
-- Tables: profiles, credit_ledger, stories, chapters, characters, comments, streaks, ad_rewards, referrals

-- Profiles (linked to Supabase Auth)
create table profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    username text unique,
    avatar_url text,
    onboarding_purpose text check (onboarding_purpose in ('authoring', 'casual', 'kids', 'language', 'other')),
    created_at timestamptz default now()
);

-- Credit ledger (append-only, source of truth for balance)
create table credit_ledger (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references profiles(id),
    amount integer not null, -- positive = credit, negative = debit
    reason text not null check (reason in (
        'purchase', 'subscription', 'ad_reward', 'streak',
        'feedback', 'referral', 'social', 'generation',
        'welcome', 'refund'
    )),
    reference_id text, -- Adapty transaction ID, story ID, etc.
    balance_after integer not null,
    created_at timestamptz default now()
);

-- Stories
create table stories (
    id uuid primary key default gen_random_uuid(),
    author_id uuid references profiles(id),
    title text not null,
    genre text[] not null,
    topic text,
    cover_image_url text,
    is_public boolean default false,
    is_curated boolean default false,
    length_type text check (length_type in ('mini', 'short', 'standard', 'long')),
    word_count integer,
    status text default 'draft' check (status in ('draft', 'generating', 'complete', 'failed')),
    created_at timestamptz default now()
);

-- Chapters
create table chapters (
    id uuid primary key default gen_random_uuid(),
    story_id uuid not null references stories(id) on delete cascade,
    chapter_number integer not null,
    title text,
    content text not null,
    word_count integer,
    audio_url text,
    created_at timestamptz default now(),
    unique(story_id, chapter_number)
);

-- Characters
create table characters (
    id uuid primary key default gen_random_uuid(),
    story_id uuid not null references stories(id) on delete cascade,
    name text not null,
    description text,
    background text,
    appearance text,
    is_hero boolean default false
);

-- Comments
create table comments (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references profiles(id),
    story_id uuid not null references stories(id) on delete cascade,
    chapter_id uuid references chapters(id),
    content text not null,
    created_at timestamptz default now()
);

-- Reading streaks
create table streaks (
    user_id uuid primary key references profiles(id),
    current_streak integer default 0,
    longest_streak integer default 0,
    last_activity_date date,
    next_credit_at integer default 3,
    updated_at timestamptz default now()
);

-- Ad reward tracking (1 per 24hr)
create table ad_rewards (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references profiles(id),
    claimed_at timestamptz default now(),
    verification_token text
);
-- Enforce 1 ad reward per user per calendar day (use timezone-explicit cast for immutability)
create unique index idx_ad_rewards_daily on ad_rewards(user_id, (date_trunc('day', claimed_at at time zone 'UTC')));

-- Referrals
create table referrals (
    id uuid primary key default gen_random_uuid(),
    referrer_id uuid not null references profiles(id),
    referred_id uuid not null references profiles(id),
    credited boolean default false,
    created_at timestamptz default now()
);

-- Indexes
create index idx_credit_ledger_user on credit_ledger(user_id, created_at desc);
create index idx_credit_ledger_balance on credit_ledger(user_id, balance_after) include (created_at);
create index idx_stories_author on stories(author_id, created_at desc);
create index idx_stories_public on stories(is_public, created_at desc) where is_public = true;
create index idx_stories_curated on stories(is_curated, created_at desc) where is_curated = true;
create index idx_chapters_story on chapters(story_id, chapter_number);
create index idx_comments_story on comments(story_id, created_at desc);
