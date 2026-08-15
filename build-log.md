# Katha AI — Build Log

> Chronological record of all changes made across sessions.
> Every session that modifies code, schema, config, or infrastructure MUST append an entry here.

---

## 2026-08-15 — Project scaffolding

**Session:** Initial project setup (from Story For My Kid Claude Code session)

### Changes
- Created project at `/Users/mac16/Katha AI/`
- **CLAUDE.md** — project context, architecture, build instructions for Claude Code sessions
- **Supabase schema (migration 00001):** profiles, credit_ledger, stories, chapters, characters, comments, streaks, ad_rewards, referrals — 9 tables with indexes
- **RLS policies (migration 00002):** row-level security for all tables
- **Edge Functions scaffolded:**
  - `generate-story` — full orchestrator (auth, credit deduct, LLM fallback chain, refund on failure)
  - `continue-story` — next chapter generation (author-only)
  - `deduct-credit` — atomic credit deduction endpoint
  - `grant-credit` — AdMob SSV reward verification + 24hr cooldown
  - `library` — paginated curated story feed with genre filter + search
  - `feedback` — comments + one-time feedback credit reward per story
  - `adapty-webhook` — subscription/purchase event handler
- **Shared utilities:** `_shared/credits.ts` (append-only ledger), `_shared/llm.ts` (Sonnet → Haiku → gpt-4o-mini), `_shared/cors.ts`
- **Story generator system prompt v1.0** — `prompts/story-generator.md`
- **Blueprint reference** — copied from Story For My Kid project
- **Strategic decisions doc** — `references/strategic-decisions.md` (product identity, credit economy, growth loops, anti-gaming pipeline, content model, CTA strategy, discovery/feed model)
- **Schema migration 00003** — delta additions from strategic decisions (story_reads, story_followers, user_followers, bookmarks, story_likes, engagement counters, chapter publishing state, language/themes, pending credits, referral chain)
- **Git initialized** with initial commit

### Decisions locked
- App name: **Katha AI — Create Stories**
- Single currency (Credits), no dual coins/gems
- Author-only continuation (readers cannot extend stories)
- AI decides story length (no length picker)
- 3-credit welcome bonus (up from Blueprint's 2)
- Front-loaded creator earnings curve (1 credit/read for first 10, then tapering)
- Full anti-gaming pipeline required for reader earnings
- Genre is single-select; themes are LLM-generated free-form tags
- UI: English + Hindi. Generation: 15 languages

### TODO next session
- [ ] Create Supabase project, set project ID in config.toml
- [ ] Create GitHub repo and push
- [ ] Build `record-read` edge function (anti-gaming pipeline from strategic-decisions.md §6)
- [ ] Build follow/unfollow, bookmark, like edge functions
- [ ] Build feed endpoints (for-you, trending, rising, new)
- [ ] Build search endpoint (pg_trgm + tsvector)
- [ ] Wire up cover image generation in generate-story
- [ ] Wire up edge-tts audio narration in generate-story
- [ ] Seed library content
