-- Strategic Decisions delta — growth loops, creator economy, social graph
-- Ref: references/strategic-decisions.md §12

-- Expand credit_ledger reason check to include reader_earning
alter table credit_ledger drop constraint if exists credit_ledger_reason_check;
alter table credit_ledger add constraint credit_ledger_reason_check
    check (reason in (
        'purchase', 'subscription', 'ad_reward', 'streak',
        'feedback', 'referral', 'social', 'generation',
        'welcome', 'refund', 'reader_earning'
    ));

-- Chapters: draft vs published state
alter table chapters add column is_published boolean default false;
alter table chapters add column published_at timestamptz;
create index idx_chapters_published on chapters(story_id, is_published, chapter_number);

-- Stories: language, themes, series planning, engagement counters
alter table stories add column language text not null default 'en';
alter table stories add column themes text[] default '{}';
alter table stories add column planned_chapter_count integer;
alter table stories add column read_count integer default 0;
alter table stories add column unique_reader_count integer default 0;
alter table stories add column like_count integer default 0;
alter table stories add column comment_count integer default 0;
alter table stories add column share_count integer default 0;
alter table stories add column follower_count integer default 0;
alter table stories add column credits_earned integer default 0;

create index idx_stories_themes on stories using gin(themes);
create index idx_stories_language on stories(language, is_public);

-- Pending credit state (fraud-review buffer, strategic-decisions §6.7)
alter table credit_ledger add column pending_until timestamptz;
alter table credit_ledger add column clawed_back_at timestamptz;

-- Referral chain + account age tracking
alter table profiles add column referred_by uuid references profiles(id);
alter table profiles add column first_generation_at timestamptz;
alter table profiles add column account_created_at timestamptz default now();

-- Read tracking (anti-gaming pipeline, strategic-decisions §6)
create table story_reads (
    id uuid primary key default gen_random_uuid(),
    story_id uuid not null references stories(id) on delete cascade,
    chapter_id uuid references chapters(id) on delete cascade,
    user_id uuid not null references profiles(id),
    device_id text,
    ip_hash text,
    duration_seconds integer,
    is_own_story boolean default false,
    counts_for_earnings boolean default true,
    read_at timestamptz default now()
);
create index idx_story_reads_story on story_reads(story_id, read_at desc);
create index idx_story_reads_user on story_reads(user_id, read_at desc);
-- Dedup: 1 crediting read per user per story per day
create unique index idx_story_reads_dedup
    on story_reads(user_id, story_id, (date_trunc('day', read_at at time zone 'UTC')))
    where counts_for_earnings = true;

-- Follow a story (chapter notifications)
create table story_followers (
    story_id uuid not null references stories(id) on delete cascade,
    user_id uuid not null references profiles(id) on delete cascade,
    followed_at timestamptz default now(),
    primary key (story_id, user_id)
);
create index idx_story_followers_user on story_followers(user_id, followed_at desc);

-- Follow an author
create table user_followers (
    author_id uuid not null references profiles(id) on delete cascade,
    follower_id uuid not null references profiles(id) on delete cascade,
    followed_at timestamptz default now(),
    primary key (author_id, follower_id),
    check (author_id != follower_id)
);
create index idx_user_followers_follower on user_followers(follower_id, followed_at desc);

-- Bookmarks
create table bookmarks (
    user_id uuid not null references profiles(id) on delete cascade,
    story_id uuid not null references stories(id) on delete cascade,
    bookmarked_at timestamptz default now(),
    primary key (user_id, story_id)
);
create index idx_bookmarks_user on bookmarks(user_id, bookmarked_at desc);

-- Likes (feed ranking + engagement)
create table story_likes (
    user_id uuid not null references profiles(id) on delete cascade,
    story_id uuid not null references stories(id) on delete cascade,
    liked_at timestamptz default now(),
    primary key (user_id, story_id)
);
create index idx_story_likes_story on story_likes(story_id);

-- RLS for new tables
alter table story_reads enable row level security;
alter table story_followers enable row level security;
alter table user_followers enable row level security;
alter table bookmarks enable row level security;
alter table story_likes enable row level security;

-- story_reads: users can view their own reads
create policy "Users can view own reads"
    on story_reads for select using (auth.uid() = user_id);

-- story_followers: users can manage their own follows
create policy "Users can view story follows"
    on story_followers for select using (true);
create policy "Users can follow stories"
    on story_followers for insert with check (auth.uid() = user_id);
create policy "Users can unfollow stories"
    on story_followers for delete using (auth.uid() = user_id);

-- user_followers: users can manage their own follows
create policy "Users can view user follows"
    on user_followers for select using (true);
create policy "Users can follow users"
    on user_followers for insert with check (auth.uid() = follower_id);
create policy "Users can unfollow users"
    on user_followers for delete using (auth.uid() = follower_id);

-- bookmarks: users can manage their own
create policy "Users can view own bookmarks"
    on bookmarks for select using (auth.uid() = user_id);
create policy "Users can bookmark"
    on bookmarks for insert with check (auth.uid() = user_id);
create policy "Users can unbookmark"
    on bookmarks for delete using (auth.uid() = user_id);

-- story_likes: users can manage their own
create policy "Users can view likes"
    on story_likes for select using (true);
create policy "Users can like"
    on story_likes for insert with check (auth.uid() = user_id);
create policy "Users can unlike"
    on story_likes for delete using (auth.uid() = user_id);
