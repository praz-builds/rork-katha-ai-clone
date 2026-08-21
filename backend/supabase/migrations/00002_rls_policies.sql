-- RLS policies for all tables

alter table profiles enable row level security;
alter table credit_ledger enable row level security;
alter table stories enable row level security;
alter table chapters enable row level security;
alter table characters enable row level security;
alter table comments enable row level security;
alter table streaks enable row level security;
alter table ad_rewards enable row level security;
alter table referrals enable row level security;

-- Profiles: users can read any profile, update only their own
create policy "Profiles are viewable by everyone"
    on profiles for select using (true);

create policy "Users can update own profile"
    on profiles for update using (auth.uid() = id);

create policy "Users can insert own profile"
    on profiles for insert with check (auth.uid() = id);

-- Credit ledger: users can only read their own (writes via edge functions only)
create policy "Users can view own credit history"
    on credit_ledger for select using (auth.uid() = user_id);

-- Stories: public/curated readable by all, own stories always readable
create policy "Public and curated stories are viewable by everyone"
    on stories for select using (is_public = true or is_curated = true or auth.uid() = author_id);

create policy "Users can insert own stories"
    on stories for insert with check (auth.uid() = author_id);

create policy "Users can update own stories"
    on stories for update using (auth.uid() = author_id);

-- Chapters: readable if parent story is readable
create policy "Chapters viewable if story is accessible"
    on chapters for select using (
        exists (
            select 1 from stories s
            where s.id = chapters.story_id
            and (s.is_public = true or s.is_curated = true or auth.uid() = s.author_id)
        )
    );

-- Characters: same access as chapters
create policy "Characters viewable if story is accessible"
    on characters for select using (
        exists (
            select 1 from stories s
            where s.id = characters.story_id
            and (s.is_public = true or s.is_curated = true or auth.uid() = s.author_id)
        )
    );

-- Comments: viewable by all authenticated users, insert own
create policy "Comments are viewable by authenticated users"
    on comments for select using (auth.role() = 'authenticated');

create policy "Users can insert own comments"
    on comments for insert with check (auth.uid() = user_id);

-- Streaks: users can only see their own
create policy "Users can view own streak"
    on streaks for select using (auth.uid() = user_id);

-- Ad rewards: users can only see their own
create policy "Users can view own ad rewards"
    on ad_rewards for select using (auth.uid() = user_id);

-- Referrals: users can see referrals they made
create policy "Users can view own referrals"
    on referrals for select using (auth.uid() = referrer_id);
