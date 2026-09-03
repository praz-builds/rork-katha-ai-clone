# Katha AI — Build Log

<!-- markdownlint-disable MD013 MD024 -->

> Chronological record of all changes made across sessions.
> Every session that modifies code, schema, config, or infrastructure MUST append an entry here.

---

## 2026-09-02 UTC — Schema and contracts for the story-creation flow (B1)

**Session:** Migrations 00027/00028 and the request contract they support. Every new column is nullable or defaults to today's behaviour, so no existing **read or write path** changes. That is not the same as the migration being unconditionally safe to apply: `stories_planned_chapter_count_check` is restrictive, so 00028 can fail on pre-existing data and requires the check below first.

The two constraints are **not** alike, and the summary previously blurred them:

| Constraint | Direction | Can validation fail? |
| --- | --- | --- |
| `generation_operations_kind_check` | **Widening** — adds `cover`, `chapter_art`, `characters` | No. Every existing row satisfies the old, narrower check, so it satisfies the new one. |
| `stories_planned_chapter_count_check` | **Restricting** — a previously free integer is now `NULL, 3, 7 or 15` | **Yes.** Any existing row holding a non-null value outside that set fails 00028. |

`planned_chapter_count` was added in migration 00003 and is written by no code path in this repository, so every row is expected to hold NULL. **That expectation is unverified** — no Supabase credentials were available here — and it is a precondition of 00028, not a consequence of it. Confirm before applying:

```sql
select count(*) from public.stories
where planned_chapter_count is not null
  and planned_chapter_count not in (3, 7, 15);
```

A non-zero result must be reconciled before 00028 runs.

### Every paid image can now reserve an operation

`generation_operations.kind` was constrained to `('story', 'continuation')`, so a cover, a chapter illustration or a cast had nowhere to record itself and would have been charged outside the idempotency and auto-refund path that makes text generation safe. The constraint now admits `cover`, `chapter_art` and `characters`, and `reserve_generation_operation` accepts them.

The active-reservation index needed widening too. It was `unique(story_id, chapter_number) where status = 'reserved'`, which encodes "one paid action per chapter" — no longer true once a chapter has both text and art. A chapter's text and its own illustration could never be reserved at the same time; the second insert raised `KTH01`. The sequential flow does not hit that today, but the constraint was wrong rather than merely conservative, so it is now `(story_id, chapter_number, kind)`.

### Columns

`chapters.image_url` / `image_prompt`; `characters.portrait_url`; and on `stories`: `where_and_when`, `moments`, `story_values`, `writing_style`, `avoid`, `chapter_length`, `illustrate_chapters`. `planned_chapter_count` already existed from migration 00003, unused, and becomes the planned length — now constrained to 3, 7 or 15.

`story_values` rather than `values` because `values` is reserved in SQL.

### The 40-character seed gate is gone

`validation.ts` rejected any idea under 40 characters. It taught padding rather than structure, and the flow document replaces it with the slot-based brief-strength meter in which a one-line idea is a legitimate choice. One non-whitespace character is the floor; the 1000-character ceiling is unchanged. Removing it from the UI alone would have produced a 400 from the server, so it had to move here first.

### The cast cap was three different numbers

The client allowed 5 (`CreateStudioScreen.tsx`), the server allowed 10 (`validation.ts`), and the spec said 3 — so a user could assemble a cast the server would reject. All three are now 3, from `MAX_CAST_SIZE` in `_shared/types.ts`.

### Writing style is sanitised, not just bounded

The new free-text style field is a direct route to "write exactly like <living author>", which `source-of-truth/STORY_PROMPT_SYSTEM.md` forbids at runtime. Imitation phrasing and the name after it are stripped and the rest of the direction is kept, so "hardboiled, like Raymond Chandler" reaches the prompt as "hardboiled". A regression test covers bare initials — an earlier pattern stopped at "Ursula" and leaked "K Le Guin". The known over-match (a capitalised phrase that is not a person, such as "in the style of Gothic Horror") is documented at the function and accepted: a regex cannot tell the two apart, and losing a little craft direction is the cheaper error. This is defence in depth; the prompt layer states the rule as well.

### Also corrected

`expo/App.tsx`'s credits explainer still described the retired bundle ("one credit each for the text, its cover and its characters"). It now states the story-start price and the per-chapter price.

### CodeRabbit review, addressed

- **The seed gate was only half removed.** `validation.ts` accepted one character but `CreateStudioScreen.tsx` still required 40, so Create stayed disabled for a valid short idea. The client condition and `getSeedHint()` now match the server; the hint encourages rather than counts toward a threshold.
- **The author-name sanitiser was ASCII-only.** `[A-Z]` and `\w` stop at the first accented character, so "Gabriel García Márquez" leaked most of the name. It now uses `\p{Lu}`/`\p{L}` with the `u` flag, with regression cases for accented and non-Latin names.
- **Both new constraints are added `NOT VALID` and validated in 00028.** A plain `ADD CONSTRAINT` holds ACCESS EXCLUSIVE for the whole table scan, whether or not that scan can fail. `NOT VALID` skips the scan and holds ACCESS EXCLUSIVE only briefly — it is still an exclusive lock, just not one held for a scan — and 00028's `VALIDATE CONSTRAINT` then does the scan under SHARE UPDATE EXCLUSIVE, which does not block reads or writes. `generation_operations` is on the hot path of every generation, so the difference matters.
- **The index rebuild cannot use `CONCURRENTLY`** — `supabase db push` wraps each migration in a transaction and concurrent index builds cannot run in one. The brief lock is documented at the statement, with the conditions under which it would need to become an out-of-band rebuild.
- **Client credit amounts moved out of copy** into `expo/src/lib/pricing.ts`, the single client-side mirror of the per-action costs. It holds no plan prices, grants or SKUs.

### Second review round

- **The credits screen advertised a price the code does not charge.** The canonical document prices a story start at 3 credits — cast, chapter 1's words, chapter 1's art — but `generate-story` makes exactly one reservation, because neither the cast nor chapter art is built yet. `pricing.ts` now separates **charged today** from **contracted**, the contracted values are marked not-yet-charged, and user-facing copy reads only the charged ones.
- **The sanitiser's `i` flag applied to `\p{Lu}` as well as the trigger**, so an uppercase-letter class matched lowercase and any prose after a trigger word was read as a name: `"like the sea at dusk"` was destroyed. Trigger and name are now two regexes — the trigger case-insensitive, the name not — and three prose-preservation cases are pinned.
- **The particle list stopped mid-name.** `"Ngũgĩ wa Thiong'o"` left `"wa Thiong'o"` behind because `wa` was not listed. The set now covers the common Romance, Germanic, Arabic, Celtic and Bantu connectives.
- The style test asserted only that no author name survived, which would have passed on gutted text. It now asserts exact output for every case.

### Third review round

- **Uncased scripts bypassed the filter entirely.** Han, Kana, Arabic, Hebrew and Devanagari letters have no uppercase, so a `\p{Lu}`-anchored pattern could never match them and "in the style of 村上春樹" passed through untouched. The name token now also accepts a run of `\p{Lo}` ("Letter, other"), which is deliberately narrow: Latin lowercase is `\p{Ll}`, so admitting uncased scripts cannot resurrect the prose bug fixed in the round before.
- Removing a name from the middle of a list left its separators behind — "dreamlike, like 村上春樹, in short scenes" became "dreamlike, , in short scenes". Runs of separators now collapse to the first.

### Fourth review round

- **The cast cap did not survive a double tap.** `addCharacter` checked `draft.characters.length` from its closure rather than `prev.characters.length` inside the updater, so two taps batched in one frame both read the stale length, both appended, and the cast came out one over the cap — which `validation.ts` then rejects. The check moved inside the updater, and three tests pin it, including one that reproduces the stale-closure behaviour so the regression is described rather than merely prevented.
- `MAX_CAST_SIZE` now lives in `expo/src/lib/pricing-limits.ts` and both the screen and the tests read it, rather than the number being restated in a comment.
- **00028 guards its own precondition** instead of only documenting it. A `DO` block counts offending rows first and raises a message naming the column and the count, rather than letting `VALIDATE CONSTRAINT` abort with something generic.
- The compatibility statement now says no existing **read or write path** changes, which is what is true — it is not a claim that the migration is unconditionally safe to apply.

### Fifth review round

- **`loadDraft()` could disable auto-save for a whole mount.** The persisted draft is typed by assertion only, so nothing guarantees `characters` is an array. Reading `.length` off a missing value rejected the promise *before* `draftRestoredRef` was set, which left auto-save off and silently discarded everything the user typed afterwards. `characters` is now normalised, and the ref is set in a `finally` so a single unreadable payload cannot disable saving.
- **`generation_operations.chapter_number` is `NOT NULL` and must be positive**, but the migration never said what a story-level operation should use. The convention is now documented at the function: `story`, `continuation`, `cover` and `chapter_art` carry the chapter they belong to; `characters` carries 1, the chapter it is generated before. The `(story_id, chapter_number, kind)` index keeps all three chapter-1 reservations distinct.
- The sanitiser's two regexes are built once at module scope rather than per request. `matchAll` copies the regex internally, so sharing one instance does not mutate `lastIndex` across calls.
- The 300-character brief-field test only checked that 301 is rejected. Flipping `>` to `>=` would have passed it, so the accept side is now pinned too.
- The `NOT VALID` lock description was imprecise: `NOT VALID` still takes ACCESS EXCLUSIVE, just briefly and without a scan. Corrected.

### Validation

- 134 Deno tests pass (9 new), `deno check` clean on every edge function, `deno fmt --check` clean.
- Expo typecheck clean, 0 lint errors, 41 Jest tests pass.
- **Migrations were not applied.** No Supabase credentials were available in this environment, so 00027/00028 are unreviewed against a live database and no production smoke test was run.

---

## 2026-09-02 UTC — The prompt reads the word band instead of restating it

**Session:** CodeRabbit review follow-up on the word-band work below. `wordBandFor()` was described as the single source of truth, but `story-prompts.ts` still carried four independent copies of the numbers, so the prompt and the validator could drift apart in exactly the way the helper was introduced to prevent.

### What changed

Every length instruction the model reads is now rendered from `wordBandFor()`:

| Site | Was | Now |
| --- | --- | --- |
| `buildBaseRules()` | `500-1500 words` | `${band.min}-${band.max} words` |
| `buildAudienceModeRules()` (Kids) | `600-900` / `500-1200` | the band for that mode |
| Continuation rules | `600-900 words` | the series band |
| `buildUserPrompt()` | three literal ranges | the band for that mode |

`buildStoryPromptBody()` resolves the band once and passes it down, so a single call decides what the whole prompt says. This also removes a live bug: a kids **standalone** prompt previously stated `500-1500` in its Hard Rules and `500-1200` in its Kids Mode block, giving the model two different ceilings in one prompt.

### Why it matters beyond the review

Chapter length becomes a user-facing control (Short / Standard / Long) in the create-flow rebuild. With the numbers centralised, that is a change to one function; with four string literals it would have been four chances to ship a prompt that contradicts the validator.

### Two inline findings, both real

**The Kids Mode length rule fought its own minimum.** It read `500-1200 words maximum. Shorter is better.` — an instruction to undershoot, sitting next to a floor of 500. A generation below 0.75x that floor is rejected by `requireUsableStoryOutput()` and burns a provider fallback, so the sentence was buying failed generations. It now reads `500-1200 words. Aim for the lower half of that range, but never go under 500.`, which keeps the brevity Kids Mode wants and the floor the validator enforces.

An existing test pinned the old sentence verbatim. It now asserts the band rather than the wording around it, which is what its name always claimed.

**`AGENTS.md` and `BUILD_LOG.md` both said covers use DALL·E 3.** `_shared/image.ts` requests `gpt-image-1`. Corrected in both.

### Validation

- 136 Deno tests pass on this branch merged with main, including five new ones: four assert the prompt quotes `wordBandFor()` for every mode combination and that a kids prompt never leaks the adult ceiling, and one pins the Kids Mode floor against the instruction that used to contradict it.
- `deno check` clean across every edge function; `deno fmt --check` clean on the CI file list.

---

## 2026-09-01 UTC — Closed the two open risks from the provider migration

**Session:** Enforced the chapter word band server-side and split the story-generation credential from the cover credential. Both were carried as known risks out of the Luna work; both are now closed on the code side.

### The word band is enforced, not just requested

`wordBandFor()` in `_shared/types.ts` is the single source of truth — `600-900` for a series chapter whatever the audience, `500-1200` standalone kids, `500-1500` standalone adult. The prompt builder and `requireUsableStoryOutput()` both read it, so the instruction and the check can no longer drift apart.

- The count comes from `chapter_body`, never the model's self-reported `word_count`. A model that ignores the band is not a reliable narrator of how badly it ignored it, and every persistence path counts the body anyway.
- Outside `wordBandBounds()` — 0.75x floor, 1.25x ceiling — the output is unusable and falls through to the next provider exactly like malformed JSON. The credit is refunded if the whole chain fails, which beats charging for a chapter that breaks reading-time estimates and narration cost downstream.
- Inside the tolerance but outside the stated band, the drift is logged and the story is kept. The band is a writing instruction, not a contract a model can hit exactly; enforcing it literally would throw away good stories. Production series chapters legitimately land at 905-945 against a 600-900 band.
- The 2,026-word `gpt-5-mini` chapter that motivated this is now a regression test, alongside the observed production spreads (846-1,353 on the standalone band, 905-945 on the series band) as the must-not-reject cases.

### Story generation has its own credential

`_shared/llm.ts` now reads `OPENAI_STORY_API_KEY` ahead of `OPENAI_API_KEY`; `_shared/image.ts` still reads `OPENAI_API_KEY`. `OPENAI_API_KEY` authenticated both `gpt-image-1` covers and story text, so one spend cap, rate limit, revocation or rotation took down covers and stories together — and with Gemini (`429`) and OpenRouter (`402`) unavailable, every position that can serve authenticates with it.

Setting the secret is now the entire remaining change and no deploy follows it. Leaving it unset preserves current behaviour, so this is safe to land ahead of the key existing.

### Validation

- `deno fmt --check`, `deno check`, **134 deno tests** pass (six new: the band mapping, runaway rejection, the must-not-reject production spreads, series-band narrowing, the no-band path, and credential precedence).
- Production `smoke-app-surface.py`: **26 / 26**; assertion 5.3 names `gpt-5.6-luna`.
- Production `smoke-series-generation.py`: **58 / 58**, with the length guard live: 1,237 words standalone, 860 and 869 on the series band. No legitimate generation was rejected.

### Still open, and both are account actions

- Set `OPENAI_STORY_API_KEY` in Supabase secrets.
- Gemini `429` and OpenRouter `402` remain unresolved, so there is still no provider-level redundancy ahead of OpenAI. Adding OpenRouter credits is the cheapest fix — `google/gemini-2.5-flash` is already pinned and deployed in that position.

## 2026-08-31 UTC — GPT-5.6 Luna live in the OpenAI position

**Session:** Made the OpenAI position an ordered model list — `gpt-5.6-luna`, `gpt-5-mini`, `gpt-4o-mini` — diagnosed and cleared a project-level entitlement block on Luna, and recorded the fallback-credential work in the roadmap. Luna now serves all production generation. PRs #40 and #41.

- `OPENAI_MODELS` makes the OpenAI position an ordered list rather than a single model: `gpt-5.6-luna`, `gpt-5-mini`, then `gpt-4o-mini`. Each entry records its own `LlmFailure`, so telemetry distinguishes an unentitled model from a broken one. The last entry must never be entitlement-gated, or an unentitled project has no working OpenAI position at all.
- Luna is a reasoning model, so the direct OpenAI call needed a second chat-completions dialect: `max_completion_tokens` instead of `max_tokens`, no `temperature`, and `reasoning_effort: "low"` because prose does not benefit from long deliberation and every reasoning token is latency the reader waits through. Reasoning tokens are counted inside the completion budget, so it carries 2x headroom over the visible story length. The OpenRouter path keeps the legacy `max_tokens` + `temperature` shape, since it still routes to models that only understand it.
- `OPENAI_TIMEOUT_MS` raised 30s -> 60s and `PHASE_END_SHARE` rebalanced to 35/50/90/100% to give the reasoning model room.

**Production result on first deploy (superseded the same day — see "Luna went live" below):** Luna returned `403 Project ... does not have access to model gpt-5.6-luna`. The model ID is correct; the OpenAI project simply is not entitled to it. The first deploy — Luna alone, replacing `gpt-4o-mini` — took generation down: every position failed and `generate-story` returned 500. The ordered-list fallback restored it in the same session. Granting project access upstream will switch production to Luna with no deploy.

The `error_events` telemetry added in this branch diagnosed it directly, with no log spelunking: one `all_providers_failed` row carrying parallel `models`, `codes` and `statuses` arrays showed `gemini=rate_limited/429`, `google/gemini-2.5-flash=provider_error/402`, `gpt-5.6-luna=auth_failed/403`, and `openrouter/free=timeout` with a null `status`, since an abort never receives an HTTP response. This is the first incident the table has paid for.

Fingerprints, per the Observability Gate in `AGENTS.md`:

| Fingerprint | Bucket | Code | Occurrences |
| --- | --- | --- | --- |
| `e113a07ec4385e039cd8453b37d69c9d` | `llm.provider` | `all_providers_failed` | 1 |
| `c3cdcc232b713a738c724bb5a65bb111` | `generation.story` | `post_deduction_failed` | 1 |

Both first and last seen `2026-08-31 18:59:59 UTC`, `occurrences = 1` in `error_event_summary` — a single incident, not a recurrence, and neither has reappeared since the ordered-list fallback landed.

### Validation

- `deno fmt --check`, `deno check`, **128 deno tests** pass, including a stalled-Luna regression that proves `gpt-4o-mini` is still sent when the preferred model hangs.
- The OpenAI window is split evenly per model rather than shared. A shared deadline let a stalled preferred model spend the whole window, and `remainingDuration` then aborted the model behind it before `fetch` was called — the same starvation `PHASE_END_SHARE` prevents between providers, recurring one level down inside the OpenAI position.
- Production `smoke-app-surface.py`: **26 / 26**; assertion 5.3 names `gpt-5.6-luna` after the entitlement was granted (`gpt-4o-mini`, then `gpt-5-mini`, on the runs before it).
- Production `smoke-series-generation.py`: **58 / 58**.

### Luna went live the same day

Granting model access at the **org** level was not sufficient: the 403 names a *project*, and the project allowlist is enforced on top of the org grant. Once access was granted on `proj_XsPb…` the chain switched to Luna with no deploy — the 403 simply stopped.

Two things worth remembering from the diagnosis:

- `GET /v1/models` listed `gpt-5.6-luna` for the whole outage. That endpoint returns the catalogue, not the entitlement, so it is useless as an access probe. A temporary diagnostic function that issued real completion requests settled it in one call: Luna `403` on both `/v1/chat/completions` and `/v1/responses`, while `gpt-5.5` and `gpt-5.4` returned `200` on the same key. The diagnostic was deleted immediately after.
- `gpt-5-mini` was added between Luna and `gpt-4o-mini` while access was pending, trading cost for quality against the only model then serving: `gpt-5-mini` ~$0.006/story against `gpt-4o-mini` ~$0.002. It stays as the second tier now that Luna is entitled, and costs the product nothing there — Luna at ~$0.004 is both cheaper *and* better than it, so `gpt-5-mini` only bills when Luna itself fails.

  Per ~1k-word story, at list prices (~700 prompt + ~3,000 completion tokens including reasoning):

  | Model | $/M in | $/M out | ~$/story |
  | --- | --- | --- | --- |
  | `gpt-4o-mini` | 0.15 | 0.60 | 0.002 |
  | `gpt-5.6-luna` | 0.20 | 1.20 | 0.004 |
  | `gpt-5-mini` | 0.25 | 2.00 | 0.006 |

Observed while `gpt-5-mini` was serving: one story came back at **2026 words** against a 500-1500 band, in-band on the surrounding runs. The band is prompt-enforced only and nothing rejects an over-length chapter, so a stronger model that ignores the ceiling reaches persistence. Not reproduced under Luna (1085-1353 words across romance/thriller/fantasy), so it is not currently biting — tracked in the roadmap rather than fixed here.

### Provider status after the fix

| Position | Status |
| --- | --- |
| `gemini-3.1-pro-preview` | `429 RESOURCE_EXHAUSTED` — Google AI quota/billing |
| OpenRouter `google/gemini-2.5-flash` | `402 Insufficient credits` — add OpenRouter credits |
| OpenAI `gpt-5.6-luna` | **serving all production generation** |
| OpenAI `gpt-5-mini`, `gpt-4o-mini` | fallback tiers, healthy |

## 2026-08-31 UTC — CodeRabbit follow-up for provider and telemetry hardening

**Session:** Addressed the CodeRabbit review on PR #39. The chain at the time was Gemini -> OpenRouter Free Router -> `gpt-4o-mini`; it was reordered later the same day so the random free router sits last, and the OpenAI position became a model list. See the Luna entry above for the current shape.

- Gemini and OpenAI-compatible provider paths now parse HTTP bodies with `response.text()` and defensive JSON parsing, preserving HTTP status classification even when an error body is plain text.
- Gemini prompt-level `promptFeedback.blockReason` is classified as a moderation rejection before candidate validation, and moderation matching no longer uses the broad bare `safety` substring.
- Error-context sanitization tests now exercise `sanitizeErrorContext()` directly for circular values while preserving allowlisted request identifiers.
- Restored migration `00018` to its original summary-view grouping shape and kept migration `00021` as the sole corrective one-row-per-fingerprint migration.
- Clarified that `00016_device_tokens.sql` remains a pending Phase G migration.
- Added and applied migration `00022` to validate the replacement `error_events.user_id` foreign key separately from the `NOT VALID` constraint creation.
- Added and applied migration `00023` so `error_events.user_id` is a detached identifier and profile deletion cannot mutate, delete, or be blocked by historical telemetry.
- Redeployed production `generate-story`, `continue-story`, and `edit-story` to project `iafeuxgoiknncgyjmugd`.

### Review follow-ups (2026-08-31 UTC)

- `ProviderModerationRejectedError` replaces the plain `Error` thrown at every moderation site. `classifyLlmError` records it as `moderation_blocked` with `retryable: false`, so `error_events` no longer files a known, non-retryable content-policy refusal as `unknown` / retryable. `isModerationRejection` still matches it by message, so the softening-retry ladder is unchanged.
- Migration `00025` gives the detached `error_events.user_id` an erasure path. `00023` removed the foreign key so telemetry could neither block nor be rewritten by profile deletion, which left the identifier with no lifecycle. `00025` nulls it on profile deletion via an `AFTER DELETE` trigger, adds `erase_user_error_telemetry(uuid)` for a request arriving after the profile is gone, and `prune_error_event_user_ids(interval)` as a 90-day retention backstop. All three are service-role only and always preserve the event row. Verified in production: profile deletion stayed non-blocking, the event row survived, `user_id` was nulled.
- Chain docstring in `_shared/llm.ts` and the provider note in `AGENTS.md` now name the deployed order and the provider actually serving.
- Added the `series_state` incomplete-shape fixture that exercises the required-key loop in `hasCompleteStoryShape`.

### Validation

- `deno fmt --check supabase/functions supabase/migrations`: passed.
- `deno check` for `generate-story`, `continue-story`, `edit-story`, `_shared/llm.ts`, and `_shared/errors.ts`: passed.
- `deno test --allow-env --allow-net supabase/functions/_shared`: **124 passed**.
- `pnpm exec expo export --platform web --output-dir /tmp/katha-web-export-pr39`: passed with bundled Node on PATH; output written to `/tmp/katha-web-export-pr39`.
- Provider-chain reorder verified in production after redeploying `generate-story`, `continue-story`, `edit-story`:
  - `smoke-app-surface.py`: **26 / 26**. Assertion 5.3 now names `gpt-4o-mini`; the same assertion named `cohere/north-mini-code:free` before the reorder.
  - `smoke-series-generation.py`: **58 / 58**.
  - Live quality read across romance / thriller / fantasy seeds: 846-1100 words, in-band, genre-appropriate prose, with `themes`, `series_state` (`open_hooks`, `world_facts`, `promised_payoffs`, `central_conflict`), `chapter_role`, `hook_type` and `hook_text` all persisted.
  - Observed chain in production today: Gemini `429 RESOURCE_EXHAUSTED` -> OpenRouter `google/gemini-2.5-flash` `402 Insufficient credits` -> `gpt-4o-mini` serves. Prose quality is therefore capped at `gpt-4o-mini` until one of the two upstream billing blockers is cleared; no code change is needed when they are.
- Security scan: no committed Gemini/OpenRouter keys or service-role-style secrets found. Existing `image-size` high advisories remain upstream-blocked pending a published patched release.
- Production smoke after redeploy:
  - `smoke-app-surface.py`: **26 / 26**, with the known cover-generation pending note unchanged.
  - `smoke-series-generation.py`: **58 / 58**, with zero observed generation failures and no stuck `reserved` operations.

## 2026-08-31 UTC — Gemini/OpenRouter story-generation chain deployed

**Session:** Replaced the active story-generation provider chain with Gemini -> OpenRouter `google/gemini-2.5-flash` -> `gpt-4o-mini` -> OpenRouter Free Router, removed Anthropic/Claude runtime dependency from `_shared/llm.ts`, set the new Supabase secrets, unset old Claude/Anthropic secret names where present, and deployed the generation functions.

### Runtime changes

- `_shared/llm.ts` now calls provider HTTP APIs directly in this order: `gemini-3.1-pro-preview`, OpenRouter `google/gemini-2.5-flash`, `gpt-4o-mini`, then OpenRouter `openrouter/free`.
- The second position is a pinned, priced OpenRouter model (65k output cap, native structured output, billed through OpenRouter so a Google-side quota block on `GEMINI_API_KEY` does not take it down).
- `openrouter/free` moved from the second position to last. It routes to a random free model per request under free-tier daily caps: the 2026-08-31 app-surface smoke run caught it serving a paragraph rewrite from `cohere/north-mini-code:free`, a code model, and a story generation timed out against it at 30s. Every model whose identity is known in advance now runs first, and the router is only the last attempt before the caller refunds the credit.
- Each provider phase is capped at a cumulative fraction of the shared deadline (`PHASE_END_SHARE`: 40% / 60% / 85% / 100%). Moderation retries are otherwise bounded only by the shared deadline, so a slow first provider could exhaust the budget and abort every fallback before it sent a request.
- Story-generation requests are schema-constrained for all providers: Gemini `responseSchema`; OpenRouter/OpenAI strict `response_format`.
- Old Claude/Anthropic env names are intentionally ignored. Regression coverage proves `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`, and `CLAUDE_TOKEN` cannot authenticate generation.
- A provider returning HTTP 200 with malformed or empty story JSON now counts as `malformed_response` and falls through to the next provider instead of reaching persistence and refunding after credit deduction.

### Observability

- Added migrations `00018` and `00019` for durable `error_events` telemetry and service-role REST access.
- Added migration `00020` so profile deletion cannot mutate historical `error_events` rows.
- Added migration `00021` so `error_event_summary` keeps one row per fingerprint and derives the highest observed severity.
- Wired `generate-story`, `continue-story`, and `edit-story` to log all-provider failures and post-deduction failures without storing story prose, prompts, seeds, or titles.
- Production provider probe showed Gemini primary is currently quota-exhausted (`429 RESOURCE_EXHAUSTED`) and OpenRouter recovered. Logged as `llm.provider` / `medium`, fingerprint `40df49d1980191986aa6f5db0e3cc1e7`.
- A production app-surface smoke found one refunded `generate-story` failure from empty/malformed provider output. Queried first, then fixed at the provider-chain boundary. Fingerprint `b6d4d193620fba18cfb6fb2273d88656`, occurrences `1` when triaged.

### Validation

- Deno check passed for `_shared/llm.ts`, `_shared/errors.ts`, `generate-story`, `continue-story`, and `edit-story`.
- Deno tests: **124 passed**.
- Security scan: no committed provider keys or Supabase secrets found. `postcss` and `uuid` advisories fixed through `expo/pnpm-workspace.yaml` overrides and a refreshed Expo lockfile. `image-size` still reports two high advisories via Expo/Metro, but the audited registry exposes no patched `2.0.3` release yet; latest available remains `2.0.2`.
- Expo typecheck, lint, and Jest passed locally (`41 / 41`). Expo Doctor now passes 14 / 18 checks: `react-native-worklets` is fixed, while local `npm` absence and the pre-existing CI-compatible `eslint-config-expo` / `jest-expo` version mismatch remain.
- Deployed `generate-story`, `continue-story`, and `edit-story` after the final fix.
- Production smoke after final deploy:
  - `smoke-app-surface.py`: **26 / 26**, with the known cover-generation pending note unchanged.
  - `smoke-series-generation.py`: **58 / 58**.

**Open:** Gemini is configured but not usable until quota/billing is fixed on the Google AI project. OpenRouter Free Router is currently carrying story generation and edit fallback successfully.

## 2026-08-30 — Backend verified end to end

**Session close.** Every edge function is deployed from `main` and exercised against the live project.

### `audio-status` told pollers to retry a job that will never exist

Any non-ok RunPod response was mapped to **502**, which means "upstream is broken, try again". An unknown or expired job id is not an upstream fault, so a polling client would spin forever. RunPod 404 now maps to 404; genuine upstream failures keep 502 and carry `upstream_status` so the cause survives into the logs.

### Final state

| Suite | Result |
|---|---|
| `smoke-series-generation.py` | **58 / 58** |
| `smoke-app-surface.py` | **26 / 26**, 1 pending |
| Deno unit tests | **121** |
| Edge functions deployed | **12 / 12** |
| Migrations applied | `00001`–`00015`, `00017` |

Defects found and fixed today, all of them by running against production rather than by reading code:

1. Production was serving a build four commits behind `main` — 683 lines of merged generation fixes were not live.
2. Five functions had never been deployed, two of them called by the client.
3. `feed` returned 500 on every call: `profiles.preferred_genres` did not exist.
4. `feed` still returned 500: `profiles.display_name` did not exist either; the column is `username`.
5. `publish-story` could never succeed — it required `chapters.is_published = true` and nothing ever set it.
6. `feed` did not typecheck; CI never checked the Deno workspace at all.
7. A stale `ANTHROPIC_API_KEY` could still have authenticated requests through the SDK's implicit env lookup.

**Still open:** the Claude leg has never executed — `CLAUDE_CODE_OAUTH_TOKEN` is unset, so all generation runs on `gpt-4o-mini`. The publish → cover pipeline is not wired on `main`. Neither is a regression; both are named in the entries below.

---

## 2026-08-30 — `feed` second missing column, and the cover pipeline is not on main

**Session:** Re-running the app-surface smoke after migration `00017` showed `feed` still returning 500. The `preferred_genres` fix was necessary but not sufficient.

### `profiles.display_name` has never existed

All four story queries in `feed` select `profiles!stories_author_id_fkey(display_name)`, and the mapper reads `profiles?.display_name`. The column on `profiles` is **`username`**:

```
{"code":"42703","message":"column profiles_1.display_name does not exist"}
```

`display_name` appears nowhere else in the repository — not in another function, not in `expo/src`, not in any migration. It was never a column; it was a guess. Switched all four selects and the mapper to `username`, keeping the response field `author_display_name` so the client contract is unchanged.

Two missing columns in one function is the same failure mode as `00008`, and it is worth naming: **a query is not verified by a typecheck.** `deno check` passes on a `.select()` string that names a column that does not exist, because the string is just a string. Only running it against the database finds these.

### The publish -> cover pipeline is not on `main`

`AGENTS.md` documents `publish-story -> generateCoverImage() -> Supabase Storage`. On `main`, **`generateCoverImage` has no caller at all** — the wiring lives in the uncommitted `regenerate-cover` work in the working tree. Publishing therefore succeeds and leaves `cover_image_url` empty.

Not a regression and not fixed here, because fixing it would collide with that in-flight branch. The smoke suite reports it as `[PENDING]` rather than a pass or a failure, so it cannot be mistaken for done.

---

## 2026-08-30 — Home feed and publishing were both structurally broken

**Session:** Deploying the five never-deployed functions exposed two client-facing paths that could not have worked. Found by a new smoke suite, not by reading the code.

### `feed` returned HTTP 500 on every authenticated call

`feed/index.ts` selects `profiles.onboarding_purpose, preferred_genres`. **`preferred_genres` was never created.** PostgREST answered `42703 column profiles.preferred_genres does not exist`, the function threw, and the Home tab got a 500 every time.

Same class as migration `00008`: code shipped against a column that only existed in someone's head. Migration `00017` adds it — `text[] not null default '{}'`, additive and safe on a live table — rather than deleting the personalisation the feed was written to use.

### `publish-story` could never succeed

It required at least one chapter with `is_published = true`, then published the story. **Nothing in the codebase ever sets `is_published`.** Not `generate-story`, not `continue-story`, and there is no chapter-level publish endpoint. `expo/src/lib/api.ts` calls `publishStory(storyId)` with a story id and nothing else, so the gate was unsatisfiable and publishing returned 400 forever.

The gate now requires a chapter to *exist*, and publishing a story publishes its chapters — which is what the single Create Studio action means. Chapters are published before the story row, so the feed can never list a story whose chapter-count query returns zero.

### Why neither was caught

Both functions had **never been deployed**. Nothing exercised them, and the CI typecheck gate would not have found either — one is a missing database column, the other a logic gap. `backend/scripts/smoke-app-surface.py` now covers library, feed, edit-story, publish-story and audio-status against the deployed project.

---

## 2026-08-30 — Full backend deployment: 12 functions live

**Session:** Brought the deployed project up to `main` and fixed the one function that could not pass the typecheck gate.

### `feed` did not typecheck

`feed/index.ts` annotated four parameters as `ReturnType<typeof createClient>`. That resolves the generic **defaults** (`schema: never`), not the instantiation `createClient(url, key)` actually returns (`schema: "public"`), so every call site failed `deno check` with TS2345. It was never caught because `feed` had never been deployed and the CI gate runs on the Expo workspace, not on the Deno functions.

Replaced with a `ServiceClient` alias derived from a real call, so the type tracks `createClient` rather than restating it.

### CI now covers the Deno workspace

The typecheck gate only ever ran on `expo/`, which is why four TS2345 errors in `feed` survived to `main`. A second CI job typechecks **every** `backend/supabase/functions/*/index.ts` by glob — so a new function is covered the day it lands rather than when someone remembers to add it — then runs the shared Deno test suite and a format check. Raised in review on PR #35.

### Deployment

All 12 edge functions deployed from `main`. Five had **never** been deployed: `audio-status`, `edit-story`, `feed`, `generate-audio`, `publish-story` — two of which (`edit-story`, `publish-story`) are called by `expo/src/lib/api.ts`, so the Create Studio edit and publish paths had been reaching functions that did not exist.

`generate-story` and `continue-story` were redeployed again after PR #34 merged, since the earlier redeploy in this log predates the OAuth resolver.

---

## 2026-08-30 — Claude OAuth-token generation credential

**Session:** Replaced the Console API-key credential for story generation with a Claude Code OAuth bearer token. Implementation originated with Codex; this session ported it onto current `main`, corrected two documentation errors, and added the test coverage.

### Branch correction (the reason this is not Codex's diff)

Codex authored its change on `codex/regenerate-cover-prompt-regressions`, which is based on `c14d3d4` — **four commits behind `main`** (PRs #30, #31, #32, #33). It therefore edited the pre-#33 `llm.ts`: 254 lines, `esm.sh/@anthropic-ai/sdk@0.30.1`, no `story_schema.ts`, no typed failures, no `editParagraph`. Landing that diff would have reverted PR #33 in full and dropped migrations `00009`-`00015` from version control.

The credential change was re-applied to `main`'s 472-line `llm.ts` on a fresh branch. Codex's working tree was left untouched.

Two documentation errors from the same staleness were corrected rather than carried forward:

- Codex's note claiming migrations `00009`-`00015` are applied remotely **with no local file** is false — all fifteen are in version control on `main`. They were absent only from its stale checkout.
- `AGENTS.md` did say "8 migrations: 00001-00008" while fifteen files existed. That line was stale on `main` (PR #32 added the files without updating it); it now reads `00001`-`00015` and directs agents to `supabase migration list` for the next free number.

### Changes

- `_shared/llm.ts`: `ANTHROPIC_API_KEY` removed. Credential resolves through `claudeAuthToken()` over `CLAUDE_CODE_OAUTH_TOKEN` -> `ANTHROPIC_AUTH_TOKEN` -> `CLAUDE_TOKEN`, first non-empty after trim. Passed to the SDK as `authToken`.
- New `ProviderNotConfiguredError`, classified `not_configured` / non-retryable. Previously a missing credential fell to the `unknown` branch and was marked **retryable**, so the chain burned both Claude attempts on a deployment gap that no retry could fix.
- Whitespace-only values are treated as absent — a secret set with a trailing newline is the common way a "configured" secret is in fact empty.

### Verification

- `deno check` clean: `_shared/llm.ts`, `generate-story/index.ts`, `continue-story/index.ts`.
- `deno fmt --check` clean for `llm.ts` and `llm.test.ts`. Repo-wide it reports 6 unformatted files under `_shared/` — **pre-existing on `main`, which has 8**; this branch formatted the two files it touched and left the rest, so a credential change does not arrive carrying formatting churn. The remaining 6 are tracked debt, not a regression.
- **119 Deno tests pass** (baseline on `main` measured at 113); 6 new, covering alias precedence, whitespace rejection, `not_configured` classification, and that a stray `ANTHROPIC_API_KEY` in the environment does **not** authenticate.
- Fault-injected both directions: re-admitting `ANTHROPIC_API_KEY` to the name list and removing `.trim()` each fail the intended test and only that test. The tests are not vacuous.
- SDK bearer transport confirmed by reading `@anthropic-ai/sdk@0.122.0` source: `authToken` produces `Authorization: Bearer <token>`; `apiKey` produces `x-api-key`. Not interchangeable.

### Not verified

**No end-to-end run against Claude.** `CLAUDE_CODE_OAUTH_TOKEN` is not set in Supabase secrets, so the Claude leg has still never executed in this project — with any credential. Whether the Anthropic API accepts a Claude Code OAuth token on `/v1/messages` via plain bearer, without additional headers, is untested here and must not be assumed. No production smoke run was performed, so no `error_events` rows were written this session.

### Deployment correction (production was serving a stale build)

`generate-story` and `continue-story` had been deployed on 2026-08-29 20:58 UTC from the stale `c14d3d4`-based tree, so **683 lines of merged generation fixes from PRs #30, #32 and #33 were on `main` but not live** — `story_schema.ts` did not exist in that build at all, meaning no schema enforcement and the old 4096-token ceiling, which is the root of the intermittent misparse.

Both were redeployed from `origin/main` (`10ecaa8`) on 2026-08-30. Verified: `generate-story` v16 -> v17 (`7fa2e09e` -> `b911ca26`), `continue-story` v19 -> v20 (`9256927a` -> `6cfcf986`), and the upload manifest lists `_shared/story_schema.ts` for both.

### Edge function inventory is not what the ROADMAP claimed

`supabase functions list` shows **7 deployed, not 10**. The ROADMAP checkbox asserting "10 edge functions deployed and ACTIVE" was ticked against a state that has never held; it is now unticked with the real inventory.

| | Functions |
|---|---|
| Deployed (7) | `adapty-webhook`, `continue-story`, `deduct-credit`, `feedback`, `generate-story`, `grant-credit`, `library` |
| **Never deployed (5)** | `audio-status`, `edit-story`, `feed`, `generate-audio`, `publish-story` |

`expo/src/lib/api.ts` calls `edit-story` (line 518) and `publish-story` (line 555), so the Create Studio edit and publish paths reach functions that do not exist in the project. `publish-story` also writes to the `covers` bucket, which does exist (see below), so deploying it is the only thing standing between the current state and a working publish path.

Not deployed in this session: the five above are a separate decision, and `publish-story` spends money on cover generation the moment it succeeds.

### Review round 1 (CodeRabbit)

- **Major, valid, fixed.** The credential was checked inside the per-model helper, so an unconfigured Claude threw the identical preflight on the Sonnet leg and again on the Haiku leg — two `not_configured` rows for one deployment gap, which inflates any occurrence count a recurrence check later reads. The check is hoisted ahead of both legs; one failure is recorded and the chain continues to OpenAI. Regression test added and fault-injected (restoring the duplicate makes it fail with `got 2`).
- **Minor, valid, fixed.** `ROADMAP.md` still recorded the dated `claude-haiku-4-5-20251001` as applied, contradicting `AGENTS.md`. Now the canonical undated id.
- **Minor, not applied.** CodeRabbit read the `2026-08-30` headings as future-dated against a review date of 2026-08-29. The dates are correct in the repo's local timezone (IST, UTC+5:30) — the redeploy recorded above ran at 2026-08-29 23:37 UTC, which is 2026-08-30 05:07 local — and the preceding entry already uses local dates. Changing them would make this entry inconsistent with the rest of the log.

### Review round 2 (CodeRabbit) — a real credential leak

- **Security, Major, valid, fixed.** `new Anthropic({ authToken })` does **not** disable API-key auth. Confirmed in `@anthropic-ai/sdk@0.122.0` source: the constructor runs `if (apiKey === undefined) apiKey = readEnv("ANTHROPIC_API_KEY") ?? null`, and `authHeaders()` returns `[apiKeyAuth(), bearerAuth()]`. A stale `ANTHROPIC_API_KEY` in Supabase secrets would therefore be sent as `X-Api-Key` **alongside** the bearer token, and could authenticate and bill traffic this project believes runs on OAuth.

  This also made the claim in the previous commit — that `ANTHROPIC_API_KEY` "is no longer read anywhere in this codebase" — **false**. The resolver ignored the name; the SDK did not. Client construction moved into `createClaudeClient()` with `apiKey: null` pinned, and `AGENTS.md` corrected.

  The earlier unit test only proved the *resolver* ignored the variable, which is why it passed while the wire was still leaking. The new test asserts the outgoing headers through an injected `fetch`: `X-Api-Key` absent, `Authorization: Bearer` present, with `ANTHROPIC_API_KEY` set in the environment. Fault-injected — removing `apiKey: null` fails it.

- **Data integrity, Major, valid.** The redeploy recorded above was from `origin/main` at `10ecaa8`, which does **not** contain the OAuth resolver. Setting `CLAUDE_CODE_OAUTH_TOKEN` alone will not activate it. `generate-story` and `continue-story` must be redeployed **after this PR merges**; tracked in Open below.

- **Minor, valid, fixed.** `ROADMAP.md` line 41 contained a raw `LegacyProjectNotLinkedError` JSON payload where the evidence should have been. Self-inflicted: an unquoted shell heredoc executed the backtick-quoted `supabase functions list` as a command substitution and pasted its error into the document. The inventory itself was gathered from a linked run and is correct; only the citation was corrupt.

### Storage buckets verified, not assumed

`AGENTS.md` and `ROADMAP.md` both said the `covers` bucket **needs creation**. It has existed since 2026-08-25: public read, 5 MB limit, `image/png` / `image/jpeg` / `image/webp`, confirmed against the storage API. Three stale checkboxes corrected.

### Open

1. **Redeploy `generate-story` and `continue-story` after this PR merges.** The current deployment is from `10ecaa8` and has no OAuth resolver, so setting the secret alone changes nothing.
2. Set `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`, not interactive login) and treat the first run as the real verification.
3. **Entitlement question:** the token authenticates a Claude subscription, a developer-tool entitlement separate from the metered API. Serving end-user generation from it should be confirmed with Anthropic before production traffic.
4. Until (2), every generation silently falls through to `gpt-4o-mini`. It does not fail — it gets quietly worse. Watch `error_event_summary` for `not_configured`.
5. `_shared/errors.ts`, `errors_test.ts` and `00016_error_events.sql` remain uncommitted in the working tree, along with the Observability Gate section Codex drafted for `AGENTS.md`. They are a coherent unit and belong in their own PR; documenting a helper this repo does not yet contain would be worse than leaving both out.

## 2026-08-30 — LLM layer: correct model IDs, enforced output schema, typed failures

**Session:** Repaired the Anthropic path, which has never run. Every generation in the previous session's smoke tests reached `gpt-4o-mini`, the third-choice fallback — the absent `ANTHROPIC_API_KEY` alone accounts for that, and the model IDs were separately found to be non-canonical.

### Model IDs

- `claude-haiku-4-5-20251001` -> `claude-haiku-4-5`, the canonical undated identifier. Standardising on the documented alias, **not** on an observed failure: the Anthropic path has never executed against this project, so the dated form's behaviour here is unverified either way.
- `claude-sonnet-4-6` -> `claude-sonnet-5`. Newer and cheaper: $2/$10 per MTok against $3/$15.
- SDK `@anthropic-ai/sdk` 0.30.1 -> 0.122.0, and the specifier moved from `esm.sh` to `npm:` because esm.sh returns 500 for the package's type declarations under `deno check`.

### max_tokens

Raised from 4,096 to 16,000 for generation (2,000 for paragraph edits). A ~900-word chapter plus a full `series_state` runs past 4,096, so responses truncated mid-JSON, parsed as garbage, and degraded to the text parser — the likely root of the intermittent `hook_type: "none"` chapters with frozen state.

### Output schema is enforced

`_shared/story_schema.ts` defines the story JSON schema once. Anthropic receives it via `output_config.format`, OpenAI via `response_format` with `strict: true`. The prompt previously only described the shape in prose, and a valid-JSON-wrong-shape response (`chapter_body` absent or not a string) fell through to the plain-text parser, which persisted a placeholder `hook_type: "none"` and an empty `series_state` while still spending a credit. Both providers require every property in `required` and `additionalProperties: false` for strict mode; tests pin that.

### edit-story was broken on main

`edit-story/index.ts` imports `editParagraph` from `_shared/llm.ts`, which did not exist — verified failing on `origin/main`, so it predates this work. Paragraph-level AI editing in Create Studio could not have functioned. The provider chain is now parameterised (`maxTokens`, `constrainToStorySchema`, `deadlineMs`) and `editParagraph` runs on it deliberately **without** the story schema, since it returns prose rather than JSON.

### Typed provider failures

`classifyLlmError()` maps SDK error classes — `NotFoundError`, `RateLimitError`, `AuthenticationError`, `APIConnectionError` before `APIError` since it subclasses it — to a stable `LlmFailure` (`provider`, `model`, `code`, `status`, `retryable`) rather than string-matching provider wording. `AllProvidersFailedError.toContext()` emits identifiers and enums only, so it feeds `logError({ bucket: "llm.provider" })` with no sanitizing. A test asserts context never carries prose, enforcing the `error_events` PII rule.

Secrets are now read lazily rather than at module load, so importing `llm.ts` is no longer a side effect requiring `--allow-env`.

### Credential status

`ANTHROPIC_API_KEY` remains unset. A `sk-ant-oat01-` OAuth access token was offered and declined: it is minted by `claude` CLI login against a Claude subscription, expires within hours, and subscription auth is not licensed to serve end-user traffic. An API key from console.anthropic.com (`sk-ant-api03-`) is required. Documented in `AGENTS.md`.

> **Superseded 2026-08-30** by the entry below. The project moved to an OAuth bearer token (`CLAUDE_CODE_OAUTH_TOKEN`) and no longer reads `ANTHROPIC_API_KEY`. The reasoning above still holds for the *short-lived* token minted by interactive `claude` login; it does not apply to the long-lived `claude setup-token` form. The entitlement question it raises remains open.

**Not yet verified against Claude.** The smoke suite has only ever run through the OpenAI fallback. The model IDs, schema enforcement and token ceiling are correct by construction and unit-tested, but the Anthropic path has not executed once. First run after the key is set should be treated as the real verification.

89 Deno tests pass (was 79). `deno check` clean for `generate-story`, `continue-story`, `edit-story` and the shared modules.

---

## 2026-08-29 — Production smoke test: three blocking defects found and fixed

**Session:** Ran the first real authenticated end-to-end test of the generation pipeline. It failed immediately, surfacing two pre-existing production defects that meant the backend had never served a single successful request, plus one defect in the series prompt system.

### 1. No table GRANTs (migration 00012)

RLS policies filter rows; they do not grant table privileges. Migrations 00001-00002 enabled RLS and created 26 policies but never issued a `GRANT`, and the project has no blanket default privileges. Measured state before the fix:

- `authenticated`: 16 of 17 tables returned `42501 permission denied`
- `service_role`: 17 of 17 returned `42501`
- The only reachable table was `profiles`, because 00006 happened to grant it explicitly

`00012` issues grants that mirror the existing policies exactly, so no operation is granted that lacks a policy and RLS stays the row-level authority. All 16 real tables were confirmed RLS-enabled first. The 00006 hardening is preserved: `profiles` keeps its column-level SELECT and `REVOKE UPDATE (status) ON stories` is re-asserted. `generation_operations` and `payment_event_backlog` stay service-only.

### 2. Migration 00008 recorded as applied but never ran (migration 00014)

All eight taxonomy columns were missing from `public.stories` while every other migration's columns were present, including 00009's. Drift was isolated to 00008.

This was the direct cause of the HTTP 500s: `generate-story` inserts `audience_mode`, `primary_genre`, `spice_level`, `identity_lenses` and `trope_modules` as its first write, which failed with `42703` and was swallowed by the handler's catch-all. `complete_story_generation` would have failed the same way on `content_rating`.

The v5.1 taxonomy shipped in PR #28 had therefore never functioned against this database. `00014` re-applies 00008 steps 1-10 idempotently; step 11 is skipped because 00010 supersedes it.

### 3. Series state echoed instead of advanced (prompt fix)

Continuations returned a complete `series_state` with every key populated, but copied verbatim from the input. Chapter 2's stored state was byte-identical to chapter 1's, so continuity froze and the finale would have worked from stale state.

Two changes, both verified by probing the model directly with a fixed fixture:

- The mid-series and finale contracts now state that returning the state unchanged is a failure, with per-field requirements (`next_chapter_pressure` must describe the next chapter, answered hooks move to `resolved_hooks`, the new hook is added to `open_hooks`).
- The output schema is now the final section of the continuation prompt. It had sat 2.4k characters from the end, behind the narrative rules, so the model's last instruction was about prose rather than format.

Before the fix the probe showed the state echoed verbatim; after, `next_chapter_pressure` changed and `open_hooks` grew from 2 to 3.

### 4. Premature trigger reverted (migration 00013)

`00012` originally bundled an `auth.users -> profiles` trigger. It was broken (`pg_catalog.nullif` is not a callable function, and the failing call sat in the DECLARE section where the EXCEPTION handler is not yet active), so it aborted every `auth.users` insert. Since there is no signup flow yet, `00013` drops it rather than shipping a corrected version. Profile creation belongs with the signup work; `credit_ledger.user_id` references `profiles(id)`, so a profile row must exist before credits can be granted.

### Results

`backend/scripts/smoke-series-generation.py` — 57 assertions across 11 groups. Three consecutive runs after the self-heal fix: 57/57, 57/57, 57/57, zero leaks. (Before it: 57/57, 57/57, 56/57.) The single miss was the model writing a real `hook_type` and `hook_text` but not recording that hook in `open_hooks`, so a later chapter had nothing to pay off. The chapter itself was sound and the credit was correctly settled, so refunding would have discarded good work for a bookkeeping miss. `continue-story` now appends the chapter's `hook_text` to `open_hooks` when the model omits it. No fixture leaked in any run.

- Seed validation: 15/28/32-char seeds rejected with 400, no credit charged
- Standalone: `standalone` role, `hook_type` none, stored `series_state` `{}`, 1028 words, 1 credit
- Idempotent replay: same chapter id, `replayed: true`, no second charge
- Series opening: `series_opening`, hook set, `central_conflict` / `open_hooks` / `next_chapter_pressure` populated, 846 words
- Mid-series: `mid_series`, state advanced from chapter 1
- Finale: `finale`, `hook_type` none, state retained
- Kids series: `content_rating` kids, 600-900 band, safe hook type
- Legacy `is_series: true` still maps to series
- Seed sweep 41 to 100 chars across six genres
- Credit exhaustion returns 402
- 12 operations all `completed`, no stuck reservations, no unexpected refunds

Seeds are written as a real user would type them (lowercase, casual) and span the full accepted 40-100 range.

### 5. Finale clears next_chapter_pressure server-side

The stricter assertions added during review caught the finale leaving `next_chapter_pressure` populated — pressure toward a chapter that will never exist. The finale contract asks for it to be empty but the model did not comply. `continue-story` now forces it, matching how `hook_type` and `hook_text` are already forced for finales. Deterministic rather than dependent on model compliance.

### Review hardening

- The trigger was removed from the `00012` source as well, so a fresh database never creates it and `00013` is a no-op there. It still matters for the linked project, where the original `00012` already ran.
- `req()` in the smoke harness returns status `0` on transport, TLS, timeout and decode failures instead of raising, and the whole flow runs under `try/finally`. Previously only `HTTPError` was handled, so a network fault would have skipped cleanup and left test stories, profiles, ledger rows and operations in the production project.
- The mid-series assertion was `new_state != ch1_state`, which any unrelated field change would satisfy. It now asserts the fields the contract names: `next_chapter_pressure` rewritten, `open_hooks` grown, and progress recorded in `character_changes` / `relationship_state` / `resolved_hooks`. The finale adds three equivalents.

`CREATE INDEX CONCURRENTLY` was raised for the two `00014` indexes and deliberately not applied: it cannot run inside a transaction block and `supabase db push` wraps each migration in one, so a separate migration would not help either. `stories` holds 0 rows and both indexes already exist.

### 6. LLM robustness

Running the suite repeatedly surfaced intermittent generation failures that a single run hid. The signature was `hook_type: none` plus a byte-identical `series_state` — `parseStructuredOutput` catching a `JSON.parse` failure and silently degrading to the text parser, which returns `hook_type: "none"` and an empty state. A broken chapter was persisted and a credit charged.

- `response_format: { type: "json_object" }` on the OpenAI fallback. The prompts require a JSON object but nothing enforced it, so occasional prose or fences broke parsing.
- `openAIContent` ignored `finish_reason`. A `length`-truncated response is partial JSON, so it now throws and the existing refund path runs instead of persisting a truncated chapter.

### 7. Field-wise series state merge

`isEmptySeriesState` is all-or-nothing, so a *partial* model response was not "empty" and overwrote stored values with blanks — one run showed a finale erasing `central_conflict` while filling `resolved_hooks`. `mergeSeriesState()` now merges per field, preferring the new value and keeping the stored one wherever the model left a blank. `next_chapter_pressure` deliberately does not carry over, since a finale clears it on purpose.

### Harness corrections

- Cleanup deleted only the story ids the run tracked. A generation that fails after the story row is inserted leaves an orphan, which blocked the profile delete with a foreign-key 409 and the auth-user delete with a 500. Cleanup now deletes `stories?author_id=eq.{uid}`, with `generation_operations` first since it references stories.
- `11.2 no unexpected refunds` treated any refund as a defect. A refund after a genuine model failure is the system working as designed. Replaced with `11.3` (every refund matches a generation failure the harness observed) and `11.4` (every operation reached a terminal state), and the harness now prints `last_error` so a refund is diagnosable.
- The `try` block started after fixture creation, so a failure during setup skipped `finally` and leaked the auth user. It now opens before the first request, verified by fault injection.
- Returning status `0` from `req()` instead of raising introduced a new gap: a create that succeeds server-side but times out on the response leaves `uid` unassigned, so cleanup skipped the account. Cleanup now looks the fixture up by exact email through the admin API. Fault-injected to confirm, which also surfaced two accounts stranded by earlier runs; both were purged.

### 8. Review pass: privilege bug, silent degradation, merge intent

A full re-review surfaced six further findings, two of them defects introduced by this PR.

- **`00015`: the `authenticated` UPDATE grant on `stories` was too broad.** `00012` issued a table-level `GRANT UPDATE` and then re-asserted 00006's `REVOKE UPDATE (status)`. A column-level REVOKE cannot subtract a column from a table-level grant, so the revoke was a no-op and story owners could set `stories.status` — exactly what 00006 prevented. `00015` grants only `title`, `topic`, `cover_image_url`, `is_public`. Verified against the project: owner UPDATE of `status` returns 403, of `title` returns 204.
- **Assertions 11.3/11.4 were documented but never landed.** The string anchor stopped matching after the try/finally re-indentation and the edit silently no-oped, so the harness still carried the old `11.2 no unexpected refunds` while the build log and commit message described its replacement. Implemented and verified in the run output.
- **`mergeSeriesState` conflated omitted with emptied.** A finale returning `open_hooks: []` kept the stale hooks, contradicting the finale contract, and a new `world_facts` entry replaced all earlier ones. Merging is now presence-aware: `open_hooks` and `promised_payoffs` are live state an explicit empty clears; `resolved_hooks`, `world_facts` and `character_changes` are history that accumulates.
- **`00014` replaced `identity_lenses` outright.** On replay that would drop every other lens from a story still carrying the legacy `lgbtq` genre. It now merges `queer` in and skips rows that already have it.

### 9. Continuations no longer degrade silently

Repeated runs showed continuations returning HTTP 200 with `hook_type: "none"` and a byte-identical `series_state`. `response_format: { type: "json_object" }` guarantees syntactically valid JSON but not the right shape: when `chapter_body` is not a string, `parseStructuredOutput` falls through to the plain-text parser, whose placeholder `hook_type: "none"` and empty state were being persisted as though they were model output. The chapter ended nowhere and continuity froze for the rest of the series, with the credit still charged.

`parseStructuredOutput` now reports whether the structured parse succeeded. `continue-story` refuses to persist an unstructured continuation, and `generate-story` refuses to start a **series** on one — a series opening with no hook and no state cannot be continued. Standalone stories need neither, so they keep the text fallback. In both cases the existing refund path runs and the reader can retry.

**Known residual:** on the `gpt-4o-mini` fallback this misparse occurs intermittently — roughly one continuation in six across observed runs. It is now a loud, refunded failure rather than a silent corruption. `ANTHROPIC_API_KEY` is still unset; the prompt system was designed for Claude, and this path is the fallback.

79 Deno tests pass (was 68). `deno check` clean. Both edge functions redeployed.

---

## 2026-08-29 — Expo sends story_mode instead of legacy is_series

**Session:** Aligned the Expo client with the generation request contract documented in PR #30.

### Change

- `expo/src/lib/api.ts` `generateStory()` sent `is_series: draft.isSeries ?? false`. The backend still maps that legacy boolean, but `story_mode` is the current contract and takes precedence in `validateGenerationRequest`. The client now sends `story_mode: draft.isSeries ? "series" : "standalone"` and no longer sends `is_series`.
- The `isSeries` boolean stays as local Create Studio draft/UI state. Only the wire format changed, so `CreateStudioScreen.tsx` is untouched.

### Tests

- New `expo/src/__tests__/api-generation-contract.test.ts` (8 tests) pins the request contract: `story_mode` is `series` / `standalone` / defaults to `standalone`, `is_series` is absent, `request_id` passes through for idempotent retries, the server `story_mode` and `chapter_role` map back onto the returned story, and `continue-story` sends `is_finale` correctly for finale and mid-series chapters.
- Expo suite: 41 tests pass (was 33). Typecheck clean, lint 0 errors and no new warnings.

### Note

- No backend change. `is_series` remains supported server-side for older clients; this only stops the shipped client from depending on the legacy path.

---

## 2026-08-29 — Series state hardening (PR #30 review fixes)

**Session:** Resolved all 11 actionable CodeRabbit findings on PR #30 (`codex/series-state-generation`) and hardened the series-state pipeline for production.

### Schema

- Added migration `00010_series_state_hardening.sql`. Migration `00009` was already applied to the linked project, so these corrections ship as a follow-up rather than an edit to an applied migration. Every statement is idempotent.
  - Named table-level `CHECK` constraints for `stories.story_mode`, `chapters.chapter_role`, and `chapters.hook_type`. `00009` declared them inline on `ADD COLUMN IF NOT EXISTS`, which silently skips the constraint when the column already exists.
  - Repaired the `00009` `chapter_role` backfill, which evaluated the `finale` branch before confirming the parent story is a series.
  - Rebuilt both completion RPCs so an invalid `hook_type` raises like the other enum parameters instead of being silently downgraded to `'none'`.
  - `complete_continuation_generation` now retains the stored `series_state` when `p_series_state` is `NULL` or `'{}'`, so one incomplete model response can no longer erase accumulated continuity.

### Prompt safety

- Persisted series state is no longer interpolated bare into the system-instruction channel. `formatSeriesStateBlock()` wraps it in an explicitly delimited `<series_state>` block labelled as untrusted data, with instructions to ignore any directive inside it.
- `formatSeriesState()` strips the fence pattern from the payload, so a crafted state value cannot close the block and escape into the instruction channel.
- Applied to the continuation system prompt, the initial user prompt, and the `continue-story` user prompt (which previously embedded raw `JSON.stringify(seriesState)`).

### Kids mode + series

- `buildAudienceModeRules()` now receives `storyMode` and `chapterRole`. Kids series openings and mid-series chapters get a reconciled ending contract: the immediate scene must resolve safely, while the larger story question may stay open only as a gentle, non-threatening invitation. Hook types are restricted to `unanswered_question`, `arrival`, and `decision`.
- Kids standalone stories and kids series finales keep the original unconditional "problems are resolved" ending rule.

### Shared normalizer

- `parseSeriesState()` and `isEmptySeriesState()` are now exported from `_shared/story_text.ts`. `continue-story` imported them and dropped its duplicate parser, which applied different limits (500/240 chars, no trimming) than the shared one (1000/500 chars, trimmed and filtered). Stored state now normalizes identically on both the generation and continuation paths.
- `continue-story` falls back to the prior stored state when the model returns an empty `series_state`.
- `generate-story` passes an explicit `EMPTY_SERIES_STATE` fallback for series stories.

### Stability

- The optional Chapter 1 callback lookup in the finale path no longer throws. A transient read error on that enrichment query previously aborted the continuation after the credit reservation existed.

### Docs

- `backend/prompts/story-generator.md`: one UI genre contract. The taxonomy table now matches the shipped Expo list (13 creation cards; `cozyFantasy` and `paranormalRomance` marked backend-only).
- `backend/ROADMAP.md`: planned device-token migration renumbered to `00011` to clear the `00009` collision.

### Second review pass

- **Kids series word range.** A kids series chapter was receiving the 500-1200 standalone range from both prompt layers while the continuation contract asks for 600-900. `buildAudienceModeRules()` now emits a 600-900 length rule for any series chapter, and `buildUserPrompt()` prioritizes the series range over the kids standalone range. Kids standalone keeps 500-1200.
- **Migration lock profile.** `00010` now runs the backfill repair first, then adds each CHECK constraint `NOT VALID`. Validation moved to `00011_validate_series_constraints.sql`: `supabase db push` runs each migration file in one transaction, so a `VALIDATE CONSTRAINT` inside `00010` would hold that migration's `ACCESS EXCLUSIVE` lock until commit and give no concurrency benefit. Splitting it lets `00010` commit first so the scan runs under its own `SHARE UPDATE EXCLUSIVE` lock. `VALIDATE CONSTRAINT` is a no-op on an already-valid constraint, so `00011` is safe against the database where `00010` had already validated them.
- **Docs.** `story-generator.md` no longer describes Bedtime as a mode separate from `kids`. The Kids Day / Kids Bedtime sections are relabelled as tonal *registers* with an explicit "style guidance, not a contract" note, and their unenforced word ranges (500-1200 / 400-800) were removed, since `buildAudienceModeRules()` is the single source of the enforced Kids constraints. The Series Chapter Structure section now documents `story_mode` as the request contract, marks `is_series` as a legacy compatibility field, and defines `is_finale` as a `continue-story` request hint (not a stored field) that, along with reaching `MAX_SERIES_CHAPTERS`, makes the server derive `chapter_role: "finale"`.
- `ROADMAP.md` records migrations 00001-00011 as applied, both edge functions as redeployed, and moves the planned device-token migration to `00012`.

### Deployment

- Migrations `00010_series_state_hardening.sql` and `00011_validate_series_constraints.sql` applied to `iafeuxgoiknncgyjmugd`. `supabase migration list` shows 00001-00011 local and remote.
- `generate-story` and `continue-story` redeployed, both ACTIVE at v9.
- The redeployed functions are compatible with the 00009 RPC signatures, so the deploy did not depend on 00010 landing first.

### Validation

- 68 Deno tests pass (was 53). Added prompt-injection regression tests with hostile text in `SeriesState` fields, fence-escape tests, kids opening/mid-series/standalone/finale prompt tests, and shared-normalizer contract tests.
- `deno check` clean for `generate-story`, `continue-story`, and the changed shared modules.
- Expo `pnpm typecheck` clean, `pnpm lint` 0 errors, `pnpm test` 33 passed.
- Security scan: no secrets in the diff, no dynamic SQL, `SECURITY DEFINER` + `SET search_path = ''` + service-role-only grants preserved on both rebuilt RPCs.

---

## 2026-08-28 — Production series state for generation

**Session:** Implemented end-to-end series-mode generation contracts across prompt spec, Supabase schema/RPCs, Edge Functions, parser tests, and Expo API typing.

### Changes

- Added migration `00009_series_state_generation.sql` with `stories.story_mode`, `stories.series_state`, and chapter-level `chapter_role`, `first_line`, `previously_summary`, `hook_type`, and `hook_text`.
- Extended `complete_story_generation` and `complete_continuation_generation` RPCs so generated chapter metadata and series continuity state persist atomically with existing credit operation locks.
- Updated `generate-story` to honor `story_mode` / legacy `is_series`, pass story/chapter role into prompts, and persist opening-chapter hooks for series.
- Updated `continue-story` to pass stored `series_state` into continuation prompts, include Chapter 1 context for finales, auto-mark Chapter 7 as finale, and persist updated hooks/state.
- Extended structured output parsing, validation, prompt tests, and Expo response mapping for series metadata.
- Updated `backend/prompts/story-generator.md` and `backend/ROADMAP.md` to reflect the implemented runtime contract.

### Dependency Notes

- RunPod remains an audio-only dependency through `generate-audio` / `audio-status`; text generation, story-mode prompts, and Supabase series state do not require RunPod changes.
- Production deployment still needs migration `00009` applied and Edge Functions redeployed.

---

## 2026-08-28 — Create Studio: Progressive Editor, generating overlay, series flow

**Session:** Full Create Studio UX overhaul — generation loading overlay, series chapter flow, cover preview, publish review, and 12 polish fixes.

### Progressive Editor Flow (Variation B)

Replaced the direct editor-to-publish modal with a 6-step flow:
`setup -> generating -> editor -> cover preview -> publish review -> publishing`

- **Generating overlay**: dark theme with glowing orange orb, concentric rotating rings, genre-aware rotating phrases with italic keyword highlights, secondary status line. Star field background.
- **Editor**: "Next" button replaces "Publish" in header and toolbar. Chapter tabs with `+` tab for series. Chapter heading hidden for standalone stories.
- **Cover preview**: genre gradient placeholder card with title overlay, "Regenerate Cover" button with custom prompt input ("Describe your ideal cover").
- **Publish review**: story card with mini cover, chapter list (series only), "What happens next" info card, sticky "Keep as Draft" / "Publish" bottom bar.

### Series Flow

- **"Make it a series" toggle** on setup screen with word count guidance (600-900 per chapter, up to 7 chapters).
- **Chapter `+` tab** in editor tab bar for adding chapters (1 credit each).
- **`continueStory()` API wrapper** calls `continue-story` endpoint with `is_finale` support.
- **Mode-aware overlay**: different phrases for story/chapter/finale generation.
- Auto-finale at chapter 7.

### API Wrappers Added (`expo/src/lib/api.ts`)

- `continueStory(storyId, requestId, isFinale?)` — calls `continue-story` endpoint
- `editParagraph(storyId, chapterId, paragraphIndex, instruction, options?)` — calls `edit-story` endpoint
- `publishStory(storyId)` — calls `publish-story` endpoint
- All three have local mock fallbacks when Supabase isn't configured.

### Mock Story Upgrade

- `localGeneratedStory()` now returns 6 genre-aware paragraphs (500-800 words) matching the 500-1500 word production spec. Was ~100 words.
- Simulates realistic 3.5-6s generation time.
- Genre-specific opening paragraphs for romance, thriller, mystery, horror, fantasy, sci-fi.
- Genre-aware creative mock titles replace `titleFromSeed()` (which just capitalized first 5 words of seed).

### UX Polish (12 fixes)

1. Toggle chips (Kids, LGBTQ+, Vampire) now single-select
2. Character fields empty by default (was pre-filled with "Mira")
3. Character placeholder: "Role, personality, and what drives them"
4. Header buttons responsive single-line ("Next >")
5. Chapter heading hidden for standalone stories
6. Action toolbar reordered: Edit, Rewrite, Expand, Shorten, Custom, Delete
7. "Change tone" removed from action toolbar
8. Paragraph editing wired to real `edit-story` API with local fallback
9. Cover prompt input for custom cover description
10. Review screen hides chapter list for standalone
11. Review bottom bar with sticky Publish/Draft buttons
12. "What happens next" info card in review

### Spec Updates (`backend/prompts/story-generator.md`)

- **Title Generation** section: 2-6 words, evocative not descriptive, genre examples
- **Word Count Enforcement** table: min/max per mode, rejection at <300 words
- **Series Chapter Structure**: cliffhanger rules for Ch 1-6, finale rules for Ch 7

### Documentation Updates

- `AGENTS.md`: Updated Create Studio flow description, migration count
- `ROADMAP.md`: Refactored — Phase A marked DONE, completed items in collapsible sections, Phase B cover items checked, migration numbers fixed, language distribution corrected
- `backend/prompts/story-generator.md`: Title rules, word count, series structure

### New Files

- `expo/src/components/GeneratingOverlay.tsx` — dark orb loading overlay
- `expo/src/data/generating-phrases.ts` — genre-aware phrase templates with keyword slots

### Modified Files

- `expo/src/screens/CreateStudioScreen.tsx` — full Progressive Editor rewrite
- `expo/src/lib/api.ts` — 3 API wrappers, mock upgrade, genre-aware titles
- `expo/src/types/domain.ts` — `isSeries` on CreateDraft
- `backend/ROADMAP.md` — refactored phases
- `backend/prompts/story-generator.md` — title/word count/series spec

---

## 2026-08-27 — Security audit + critical/high fixes

**Session:** Created custom security-scan skill, ran full audit via 3 parallel CLI agents, fixed all critical and high code-level findings.

### Security Skill

- Created `.agents/skills/security-scan/SKILL.md` — zero-dependency security scanning powered by the CLI agent itself. Covers 8 categories: secrets, injection, auth, input validation, dependencies, infrastructure, mobile, data privacy.
- Installed `@openai/codex-security` v0.1.20 globally + 14 skill files synced. Not used for scanning (requires gpt-5.6-sol access); custom skill used instead.

### Audit Results

- **2 CRITICAL, 6 HIGH, 9 MEDIUM, 5 LOW** findings across 330+ files.
- 3 parallel scan agents: secrets exposure, injection/auth, deps/mobile/infra.

### Fixes Applied (commit 7baea6a)

| ID | Severity | Fix |
|---|---|---|
| CRIT-2 | Critical | `audio-status`: parseUuid() on story_id/chapter_id, voice_id allowlisted. Path traversal eliminated. |
| HIGH-2 | High | `edit-story`: tone allowlisted to 10 values, custom notes wrapped + truncated. Prompt injection mitigated. |
| HIGH-3 | High | `generate-audio`: parseUuid() replaces raw string checks. |
| HIGH-4 | High | `audio-status`: ownership verification before writing audio_url. |
| HIGH-5 | High | `feed`: fixed following_id -> author_id column name (was crashing returning-user feed). |

### Remaining (non-code)

- CRIT-1: Rotate OpenAI API key at platform.openai.com
- HIGH-1: Rate limiting (needs Redis/KV — follow-up PR)
- HIGH-6: Set production CORS origin in Supabase secrets

---

## 2026-08-27 — Create Studio UX polish + draft persistence

**Session:** Product UX improvements to the Create flow and draft auto-save.

### Changes

- **Genre chips**: emoji-driven pills in 2-row horizontal scroll (Tumblr-style).
  Romance cluster positioned for genre variety visibility.
- **Toggle chips**: added Kids (audience mode), LGBTQ+ (identity lens), Vampire
  (trope module) as tappable chips below genre picker.
- **Dynamic seed hints**: progressive coaching text that changes as user types.
  Warm red pre-threshold, green when ready.
- **Premise chips**: 3 genre-specific example premises per genre, horizontal
  scroll, max-width 260px. Disappear after 20 chars typed.
- **Hero toggle**: replaced green RN Switch with custom Pressable toggle
  (orange thumb on light-orange track). Works on web, iOS, Android.
- **Draft persistence**: `AsyncStorage`-based auto-save with 500ms debounce.
  Drafts restored on mount, cleared on successful generation, expire after 7 days.
- **Library layout**: compact StoryCards as horizontal rows (96px cover + text),
  proper margins and spacing.
- **Header alignment**: CREATE eyebrow + credits pill on same horizontal line.
- **Renamed "Story seed" to "Your story idea"**.
- **Languages**: English + Spanish (removed Portuguese from create flow).

---

## 2026-08-27 — Story Generator v5.1 implementation

**Session:** Full implementation of v5.1 taxonomy across backend + Expo.

### Changes

- **Migration 00008:** Added `primary_genre`, `audience_mode`, `identity_lenses`, `trope_modules`, `spice_level`, `content_rating`, `first_line`, `previously_summary` columns. Backfills from `genre[]`. Replaces `complete_story_generation` RPC with extended 10-param signature.
- **New `_shared/types.ts`:** 15 primary genres, audience modes, identity lenses, spice levels, 10 trope modules, genre-aware constraint maps, migration map, interfaces.
- **New `_shared/validation.ts`:** Request validation with genre normalization, spice clamping, trope filtering, audience constraints, 40-char seed minimum.
- **Rewrote `_shared/story-prompts.ts`:** Modular 10-layer assembly (base + engine + genre + audience + identity + trope + spice + continuation + language + JSON schema). Added 4 new genre modules (darkRomance, cozyFantasy, paranormalRomance, contemporary). Deprecated genres map to new ones. Old 2-arg signatures kept as backward-compat wrappers.
- **Updated `_shared/story_text.ts`:** Added `parseStructuredOutput()` for JSON parsing with text fallback.
- **Updated `_shared/cover-prompts.ts`:** Added darkRomance, cozyFantasy, paranormalRomance, contemporary configs. Removed drama, sliceOfLife. Updated `normalizeGenre()`.
- **Updated `generate-story/index.ts`:** Uses new validation, inserts `primary_genre` + taxonomy fields, parses structured JSON output, derives content_rating server-side, passes extended RPC params.
- **Updated `continue-story/index.ts`:** Reads new story columns, builds modular continuation prompt, uses structured output parser.
- **Updated `feed/index.ts`:** Selects `primary_genre`, uses it for affinity scoring, excludes `content_rating = 'explicit'`.
- **Updated `library/index.ts`:** Filters by `primary_genre` instead of `genre[]` contains, excludes explicit content.
- **Expo `domain.ts`:** 13 UI genres, `CreateDraft` with `primaryGenre`, `audienceMode`, `spiceLevel`, `identityLenses`, `tropeModules`.
- **Expo `theme.ts`:** 13 genre labels and gradients.
- **Expo `seed.ts`:** 13 genres, remapped drama/bedtime stories.
- **Expo `api.ts`:** Sends new fields, reads `primary_genre` from response.
- **Expo `CreateStudioScreen.tsx`:** Updated draft type, genre selector uses 13 genres, 40-char seed minimum.
- **Expo `KathaOnboardingFlowV2.jsx`:** 14 genre options (13 + Other).
- **46 backend tests** (16 validation + 22 prompts + 8 parser): all pass.
- **33 Expo tests** (theme, seed, i18n, analytics, supabase): all pass.

### Notes

- `genre text[]` column kept for backward-compat reads. New writes populate both `genre` and `primary_genre`.
- `explicit` spice is feature-flagged (rejected at validation).
- 5-screen Create flow redesign is follow-up PR.

---

## 2026-08-27 — Story prompt v5.1 production spec

**Session:** Reviewed the research-backed v5 prompt architecture and converted
the backend prompt reference into a production implementation contract.

### Changes

- Updated `backend/prompts/story-generator.md` from v2.0 to v5.1 production
  spec.
- Locked the proposed taxonomy to 15 user-facing adult genre cards, with LGBTQ+
  as a separate queer identity lens/toggle instead of a primary genre.
- Documented genre-aware spice layering with `sweet`, `steamy`, and
  feature-flagged `explicit`; MVP recommendation is Sweet + Steamy only.
- Reframed Kids and Bedtime as audience modes that force Sweet content and have
  separate safety/read-aloud constraints.
- Added the required story-engine layer, structured-output contract, safety
  boundaries, implementation dependency checklist, and known current mismatches
  for the production implementation pass.

### Notes

- No runtime TypeScript, schema, or Expo UI files were changed in this session.
  The next implementation pass must update backend prompt builders, request
  validation, Supabase columns, feed/library filters, Expo genre controls, and
  cover prompt mappings together.

---

## 2026-08-15 — Project scaffolding

**Session:** Initial project setup (from Story For My Kid Claude Code session)

### Changes

- Created the backend workspace, now located at the repository-relative `backend/` directory
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

---

## 2026-08-17 — Rork app review + backend roadmap

**Session:** Full codebase review of Rork-built app (both iOS + Android) against all 12 prompts + fix-up prompt

### Changes

- **ROADMAP.md** — created phased backend execution plan (A through H)
- **CLAUDE.md** — updated architecture section (Rork is native Swift+Kotlin, not React Native), updated build phases, added Rork app status, added new edge functions to TODO list
- **build-log.md** — this entry

### Rork App Status

- **Repo:** `praz-builds/rork-katha-ai-clone` (GitHub, private)
- **Original repo** `praz-builds/rork-katha-ai` confirmed safe to delete (clone is strict superset with 16 additional files)
- **iOS:** 40+ screens in Swift/SwiftUI, Literata font bundled, all features in mock mode
- **Android:** Full parity — 40+ screens in Kotlin/Jetpack Compose, same feature set
- **All 12 prompts delivered:** Foundation, Auth, Create Wizard, Series/Continuation, Profiles, Engagement, Search/Bookmarks, Credits/Ads, Fix-up, Analytics, Parental/Language, Streaks/Notifications/Referrals/Offline/Audio

### Review Findings (critical gaps for fix-up prompt)

- Color tokens: nearly every hex deviates from spec (Rork generated own palette)
- Only 12 of 30 seed stories exist; no language field on Story model
- Home screen missing 6 of 8 sections (Continue Reading, For You, Writers You Follow, Rising, Katha's Picks, Welcome-back)
- Reader missing drop cap, progress bar, nav auto-hide
- StoryCard layout is vertical instead of spec's horizontal
- Library has 5 tabs instead of 4
- Author follower counts all wrong
- The full fix-up list is retained in this build-log entry and `ROADMAP.md`.

### Known Backend Bugs Confirmed

- `generate-story/index.ts:137` — double-deduct in response body
- `credits.ts` — race condition (read-then-write, not atomic)
- `llm.ts` — Haiku model ID outdated (Oct 2024 → should be Oct 2025)
- `generate-story` — hardcoded system prompt instead of loading from file

### TODO next session

- [ ] Phase A: Create Supabase project, fix critical bugs, deploy existing functions
- [ ] Phase B: Wire DALL-E 3 + edge-tts into generation pipeline
- [ ] User: Get API keys (Anthropic, OpenAI), create Supabase project

---

## 2026-08-17 — Phase A: Supabase setup + bug fixes + deploy

**Session:** Created Supabase project, fixed all 4 known bugs, deployed all edge functions

### Infrastructure

- **Supabase project created:** `iafeuxgoiknncgyjmugd` (region: ap-northeast-2 Seoul)
- **New key format:** publishable/secret (maps to anon/service_role)
- **Supabase CLI installed** via Homebrew (v2.114.0)
- **Project linked** and all migrations pushed
- **`.env.local` created** with project URL + keys (gitignored)
- **`config.toml` updated** with project ref, OAuth providers disabled (need real client IDs)

### Bug Fixes

1. **Double-deduct fix** (`generate-story/index.ts:137`): `newBalance - 1` → `newBalance` (was subtracting again after deductCredit already returned the post-deduction balance)
2. **Race condition fix** (`credits.ts`): replaced read-then-write pattern with atomic Postgres RPC functions (`deduct_credit`, `grant_credit`) using `FOR UPDATE` row locking
3. **System prompt fix** (`generate-story/index.ts`): hardcoded string → imported from `_shared/prompts.ts` (mirrors `prompts/story-generator.md`)
4. **Haiku model ID fix** (`llm.ts:45`): `claude-haiku-4-5-20241022` → `claude-haiku-4-5-20251001`

### Schema Changes

- **Migration 00004** (`00004_atomic_credit_rpcs.sql`): added `deduct_credit()` and `grant_credit()` Postgres functions with `SECURITY DEFINER` and `FOR UPDATE` locking
- **Migration 00001 fix**: `idx_ad_rewards_daily` — `claimed_at::date` → `date_trunc('day', claimed_at at time zone 'UTC')` (immutability fix)
- **Migration 00003 fix**: `idx_story_reads_dedup` — same `::date` → `date_trunc` fix

### New Files

- `supabase/functions/_shared/prompts.ts` — story generator system prompt as exportable constant
- `supabase/migrations/00004_atomic_credit_rpcs.sql` — atomic credit RPC functions

### Deployments

All 7 edge functions deployed and ACTIVE:

- `generate-story`, `continue-story`, `deduct-credit`, `grant-credit`, `library`, `feedback`, `adapty-webhook`

### TODO next session

- [ ] Set API key secrets (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) once user has them
- [ ] Phase B: Wire DALL-E 3 cover images + edge-tts audio narration
- [ ] Create Supabase Storage buckets (covers, audio)
- [ ] Consider recreating project in Mumbai region for lower India latency

---

## 2026-08-22 — CodeRabbit credit and generation hardening

**Session:** Remediation of PR #3 critical merge-risk findings

### Changes

- Added migration `00005_secure_credit_operations.sql` with service-only RPC permissions, positive amount validation, text reference IDs, per-user serialization, and idempotency indexes.
- Added a nullable operation key for new idempotent mutations instead of imposing uniqueness on historical reference IDs that older continuation flows reused.
- Added atomic story completion so the story update and first chapter insert commit together.
- Changed initial and continuation generation to use deterministic credit references and refund persistence failures.
- Disabled the generic client-controlled deduction endpoint and unverified AdMob reward endpoint.
- Changed Adapty authentication to exact `Authorization` secret verification, fail-closed configuration, `customer_user_id` mapping, explicit product allowlisting, and transaction-level idempotency.
- Restricted feedback rewards to public stories not authored by the commenter, verified chapter ownership, and enforced the documented daily reward check.
- Added focused Adapty unit tests and executed all five migrations against an in-memory PostgreSQL runtime, including permission, replay, concurrency, feedback, and story-completion behavior checks.
- Added durable `generation_operations` state keyed by client request ID; story/chapter completion and compensation now update operation state atomically, completed requests replay existing results, and refunded continuations can retry with a new request.
- Added feedback request idempotency, updated reader/comment RLS policies in the forward migration, bounded continuation prompt context, strict generation input limits, abortable LLM timeouts, strict library pagination, and fully qualified Adapty product IDs.
- Trial conversions now grant the paid-period credits. Refund events fail closed with a retryable response until the explicit clawback policy is implemented.
- Enforced the locked short-story-only generation contract in both the Edge Function and Expo request payload.
- Added PGlite regression tests for exactly-once generation debit/refund behavior, completion/refund races, idempotent feedback rewards, and cross-account provider transaction replay prevention.
- Added five-minute stale-reservation reconciliation on client retry; abandoned generation work is refunded while late successful completion still wins under the operation row lock.
- Added `payment_event_backlog` so unimplemented Adapty refund clawbacks are visible and retryable instead of existing only in logs.
- Added stable SQLSTATE handling for concurrent chapter reservations, shared request/operation parsers, cross-story feedback replay rejection, bounded library filters, and validated OpenAI response decoding within the abort deadline.
- Replaced calendar-day ad-reward uniqueness with an index supporting a future atomic rolling 24-hour verification transaction.
- Made fallback Adapty refund event IDs deterministic from the raw request body and covered provider-ID priority plus replay stability in tests.
- Aligned the runtime and canonical generation prompt to the locked 500-1500 word short-story contract and updated the Sonnet model identifier.
- Added malformed-body and UUID validation, mandatory client request IDs, explicit unpublished chapter state, refund-replay semantics, owner-safe story update grants, and reader-visibility RLS coverage.
- Annual Adapty events fail closed until monthly allocation scheduling is implemented; provider SKU coverage is checked against the complete allowlist.
- Confirmed the current generation runtime is text-only; cover images and audio narration remain undeployed Phase B work.
- Confirmed rewarded AdMob credits remain disabled pending direct signed SSV callbacks, server-issued user-bound claim nonces, global transaction replay protection, and atomic cooldown/grant handling.
- Added migration `00006_public_data_hardening.sql` to restrict profile reads to display-safe columns, remove client story-status updates, and index title search with `pg_trgm`.
- Isolated the title-search index in migration `00007_story_title_search_index.sql` so current Supabase CLI runners can execute `CREATE INDEX CONCURRENTLY` outside their batched transaction.
- Replaced wildcard CORS with an exact `ALLOWED_ORIGINS` allowlist and added cached preflight responses.
- Preserved generated paragraph boundaries through a shared response parser, switched continuation credit errors to stable SQLSTATE handling, and made payment-backlog retries preserve terminal rows.

### Deployment status

- Code changes and migrations were reviewed and merged through PR #3, then deployed to the linked Supabase project on 2026-08-22.
- Migrations `00005`, `00006`, and `00007` plus the changed Edge Functions are deployed.
- `ALLOWED_ORIGINS` is configured for the exact local Expo web origin `http://localhost:8090`; add the exact production Expo web origin before serving production browser clients.
- Adapty dashboard authorization and exact product IDs must match the server configuration before production webhook traffic is enabled.
- Adapty refund clawbacks and monthly allocation for annual plans remain explicit production blockers; refund events currently fail closed rather than being acknowledged without accounting.

## 2026-08-22 — Concurrent story-title search index

- Added `00007_story_title_search_index.sql` with `idx_stories_title_trgm`, a concurrent GIN trigram index for leading-wildcard title search.
- Kept the pipeline-incompatible index statement in its own migration so current Supabase CLI migration runners execute it outside the batched transaction.
- The migration was deployed to the linked Supabase project on 2026-08-22.

## 2026-08-22 — Controlled backend release to Supabase

**Session:** Deployed the reviewed PR #3 backend hardening set to the canonical Supabase project.

### Infrastructure

- Linked the monorepo backend checkout to Supabase project `iafeuxgoiknncgyjmugd`.
- Applied migrations `00005_secure_credit_operations.sql`, `00006_public_data_hardening.sql`, and `00007_story_title_search_index.sql` with `supabase db push`.
- Deployed all seven Edge Functions from the reviewed monorepo state:
  - `generate-story`
  - `continue-story`
  - `deduct-credit`
  - `grant-credit`
  - `library`
  - `feedback`
  - `adapty-webhook`
- Deployed `adapty-webhook` with JWT verification disabled so provider callbacks can reach the function after `ADAPTY_WEBHOOK_SECRET` is configured.
- Set `ALLOWED_ORIGINS=http://localhost:8090` for local Expo web verification. Production browser traffic remains blocked until the exact production origin is known and added.

### Verification

- `supabase db push --dry-run` reported only `00005`, `00006`, and `00007` pending.
- `supabase db push` applied `00005`, `00006`, and `00007` successfully.
- `supabase migration list --linked` now reports local and remote migrations `00001` through `00007` aligned.
- `supabase functions list --project-ref iafeuxgoiknncgyjmugd` reports all seven functions ACTIVE; `adapty-webhook` has `verify_jwt=false`.
- `/Users/mac16/.deno/bin/deno fmt --check supabase/functions supabase/migrations/00005_secure_credit_operations_test.ts` passed.
- `/Users/mac16/.deno/bin/deno check ...` passed for shared utilities, all function entrypoints, and the migration test.
- `/Users/mac16/.deno/bin/deno test --allow-env --allow-net --allow-read supabase/functions/_shared/*_test.ts supabase/migrations/00005_secure_credit_operations_test.ts` passed: 25 tests.
- `POST /functions/v1/adapty-webhook` without `ADAPTY_WEBHOOK_SECRET` returns `503` with `Webhook is not configured`, confirming fail-closed behavior.
- `OPTIONS /functions/v1/library` from `http://localhost:8090` returns `Access-Control-Allow-Origin: http://localhost:8090`.
- The same preflight from `https://example.com` returns no `Access-Control-Allow-Origin`.

### Remaining blockers

- `ANTHROPIC_API_KEY` is not configured in Supabase secrets; `OPENAI_API_KEY` is configured.
- `ADAPTY_WEBHOOK_SECRET` is not configured, and dashboard authorization/product IDs still need verification before real Adapty traffic.
- The exact production Expo web origin is not known; add it to `ALLOWED_ORIGINS` before production browser clients call the functions.
- No authenticated test user/JWT was available in this session, so live `generate-story`, `continue-story`, `feedback`, and disabled credit endpoint behavior were not exercised end to end.
- Annual subscription monthly allocation, refund clawbacks, and AdMob SSV remain production blockers.

## 2026-08-26 — Genre-aware anti-slop story prompt system

**Session:** Production-grade story generation prompt rewrite, dramatic arc guidance, series structure.

### Story Generation Prompt System

- Created `_shared/story-prompts.ts` (540+ lines): genre-aware prompt builder replacing the 31-line generic prompt in `_shared/prompts.ts`.
- **Anti-slop rules**: 43 banned AI-overused words, 42 banned cliche phrases, 10 banned AI-default character names.
- **Craft rules**: show-don't-tell enforcement, sentence rhythm variation, dialogue craft (said-only tags, distinct character voices, interruptions), sensory grounding (2+ senses beyond sight), no em dashes, no meta-commentary.
- **16 genre-specific voice modules**: romance, fantasy, romantasy, mystery, thriller, horror, scifi, adventure, historical, darkAcademia, drama, sliceOfLife, mythology, poetry, comedy, bedtime.
- **Cultural context**: AI infers culture from character names and traits naturally.
- **Language-aware**: 15 supported languages normalized before prompt interpolation.
- Genre and language normalized to supported enums to prevent prompt injection.

### Dramatic Arc & Series Structure

- **Standalone stories**: setup 30%, rising tension 40%, climax + aftermath 30%. Climax is mandatory.
- **Mid-series chapters** (`mode: "chapter"`): advance plot, end on hook, never resolve central conflict.
- **Series finale** (`mode: "finale"`): resolve main arc, callback to earlier chapters, close doors.
- `MAX_SERIES_CHAPTERS = 7` enforced in `continue-story` endpoint.
- Auto-finale at chapter 7. Optional `is_finale` flag for early endings.

### Input Validation

- Story seed minimum raised from 4 to 20 characters (client-side and server-side).
- Language field now sent from Expo client to backend API.

### Files Changed

- `_shared/story-prompts.ts` (NEW)
- `generate-story/index.ts` (updated)
- `continue-story/index.ts` (updated)
- `expo/src/screens/CreateStudioScreen.tsx` (updated)
- `expo/src/lib/api.ts` (updated)
- `expo/src/i18n/en.json`, `es.json`, `pt.json` (updated)

### Documentation

- Created `AGENTS.md` as canonical repo instruction file for all agent sessions.
- `CLAUDE.md` and `CODEX.md` simplified to redirect to `AGENTS.md`.

### PR Status

- PR #24 (`codex/story-prompt-system`): CodeRabbit APPROVED after 4 review rounds.

---

## 2026-08-26 — Cover image system, sample stories, dev tooling, instruction consolidation

**Session:** Full-day production session covering cover image generation, focal-point display, 3 sample stories, developer tooling, Expo skills integration, and instruction file consolidation.

### Cover Image Pipeline (PR #25)

- **`_shared/image.ts`** (198 lines): OpenAI `gpt-image-1` integration at 1024x1536 portrait. Handles base64 response decoding, 3-attempt retry with progressive prompt simplification on moderation rejection, uploads to Supabase Storage.
- **`_shared/cover-prompts.ts`** (235 lines): 16 genre-specific prompt configs (style, palette, composition, mood, characterApproach). `normalizeGenre()` prevents prompt injection via own-property check. `buildCoverPrompt()` assembles dynamic prompts from genre + title + themes + characters.
- **`backend/COVER_IMAGES.md`** (189 lines): Canonical reference for the entire cover system — prompt structure, focal point math per viewport, genre table, API call spec, retry strategy, display layouts.

### Focal-Point Display System (Strategy 1c)

- **`FocalImage` component** (`KathaPrimitives.tsx`): Renders web-native `<img>` with `object-fit: cover` + `object-position` for focal-point-aware cropping. React Native Web's Image component ignores `objectPosition`, so raw `<img>` is required. Falls back to standard RN Image on native.
- **Story type extended**: Added `focalX?: number` and `focalY?: number` (0-1) to `domain.ts` Story type.
- **Per-placement crop math**: Library card (1:1 square, y = focalY - 0.07), mobile hero (3:4 full-bleed, y = focalY - 0.02), desktop cover (3:4 sticky, y = focalY).

### Reader Screen Redesign

- **Mobile (< 768px)**: Full-bleed 3:4 hero image with LinearGradient fade into page background, floating white pill back button.
- **Desktop (>= 768px)**: Two-column layout — 200px sticky cover on left, reading column on right. `maxWidth: 700`, centered.
- **Chapter navigation**: Pill-style chapter selector (Ch 1 / Ch 2 / Ch 3) for multi-chapter stories. Audio stops and unloads on chapter switch.
- **Voice toggle**: Hidden when only one narration voice is available.
- **All existing features preserved**: audio playback, engagement bar, comments, author card, bookmark, share.

### Library Card Redesign

- Square (1:1) cover tile with focal-point anchoring, no text overlay on image.
- Title + meta line ("Genre . Xk reads") below the card.
- Card width ~172px, borderRadius 20, warm shadow.
- Rail gap reduced from 20px to 12px.

### 3 Production-Grade Sample Stories

Generated via the story prompt system and validated against all anti-slop rules:

| Story | Genre | Language | Chapters | Words | Cover | Audio |
|-------|-------|----------|----------|-------|-------|-------|
| The Vanilla Problem | romance | EN | 1 | 1,632 | OpenAI gpt-image-1 | Seed Audio (Brielle) |
| The Decimal Point | mystery | EN | 3 | 3,006 | OpenAI gpt-image-1 | Seed Audio (Holden) |
| Las cien luces de Don Aurelio | bedtime | ES | 1 | 1,048 | OpenAI gpt-image-1 | Inworld TTS (Lupita) |

QA results: 0 banned words, 0 banned phrases, 0 banned names, 0 em dashes, 0 bad dialogue tags across all 5 texts.

### Developer Tooling (PR #26)

- **ESLint 9**: `eslint.config.js` (flat config with `eslint-config-expo`). 0 errors, 22 warnings (pre-existing).
- **Jest 29**: `jest.config.js` (jest-expo preset, pnpm transforms, `@/` alias). 5 suites, 33 tests.
- **Test suites**: theme tokens, i18n key parity, analytics no-op, supabase config, seed data validation.
- **CI**: `.github/workflows/ci.yml` — typecheck + lint + test on every PR. Pinned action SHAs, `permissions: contents: read`, pnpm 11.
- **Dependencies added**: `react-native-reanimated@~4.1.7`, `react-native-gesture-handler@~2.28.0`, `expo-haptics@~15.0.8`, `eslint@^9`, `eslint-config-expo`, `jest`, `jest-expo`, `@testing-library/react-native`.
- **Design tokens**: `typography.ts` (7 text styles), `shadows.ts` (3 elevation levels), `motion.ts` (3 duration tokens), `index.ts` barrel export.
- **Design drift fixes**: 30+ hardcoded `#FFFFFF` replaced with `colors.surface`, barrel import fixes in 3 files.

### Expo Skills Integration

27 Expo skills installed locally from `github.com/expo/skills` into `.agents/skills/`:

| Category | Skills |
|----------|--------|
| Core | expo-overview, expo-router, expo-animation, expo-design-system, expo-native-ui, expo-ui |
| Data | expo-data-fetching |
| Build | expo-dev-client, expo-module, expo-upgrade, expo-project-structure |
| EAS | eas-app-stores, eas-workflows, eas-update-insights, eas-observe, eas-simulator, eas-hosting |
| Platform | expo-app-clip, expo-brownfield, expo-web-to-native, expo-dom, expo-tailwind-setup |
| Reference | expo-examples, expo-skill-eval, expo-api-docs, expo-review |

**Skill routing table** added to AGENTS.md mapping every task category to its skill path.
**Mandatory skill usage rules**: animation gate check, design token imports from barrel, navigation via expo-router skill.

### Theme Token Expansion

8 new sepia design tokens added to `theme.ts` for the reader/cover design handoff:

`sepiaHeading`, `sepiaBody`, `sepiaMuted`, `sepiaSecondary`, `sepiaAccent` (darkened to `#A64C1C` for 4.5:1 contrast), `sepiaButton`, `sepiaPlaceholder`, `sepiaToggleTrack`

### Instruction File Consolidation

- **`AGENTS.md`** expanded from 150 to 456 lines with 15 sections. Now contains ALL information previously split across root CLAUDE.md, backend/CLAUDE.md, and expo/CLAUDE.md: infrastructure & services, database schema, edge functions, monetization, audio narration, app architecture, build & deploy.
- **`CLAUDE.md`** (root): Replaced duplicate content with 5-line redirect to AGENTS.md.
- **`CODEX.md`**: Replaced chain redirect (CODEX → CLAUDE → AGENTS) with direct redirect to AGENTS.md.
- **`backend/CLAUDE.md`**: Replaced 233-line standalone file with 5-line redirect to AGENTS.md (all info synthesized into the canonical file).
- **`story-generator.md`**: Updated from v1.0 (35 lines, basic rules) to v2.0 (120 lines) matching the story-prompts.ts implementation.

### OpenAI API Key

- Key set in Supabase secrets (updated by user).
- Key saved to `backend/.env` for local development (gitignored).
- Model confirmed: `gpt-image-1` (dall-e-3 no longer available on this project's API key).

### PR History

| PR | Title | Status |
|----|-------|--------|
| #25 | Cover image system with focal-point cropping and sample stories | MERGED (3 rounds, 16 comments addressed) |
| #26 | Dev tooling, design tokens, test coverage, and drift fixes | MERGED (CodeRabbit approved) |
| #24 | Genre-aware anti-slop story prompt system + instruction consolidation | MERGED (rebased onto main, CodeRabbit approved) |

### Files Changed (across all 3 PRs)

- 33 files changed, ~3,600 insertions
- New backend files: `_shared/story-prompts.ts`, `_shared/cover-prompts.ts`, `_shared/image.ts`, `COVER_IMAGES.md`
- New expo files: 3 cover images, 5 test suites, 4 design token files, ESLint config, Jest config, CI workflow
- Updated: `App.tsx`, `KathaPrimitives.tsx`, `domain.ts`, `seed.ts`, `images.ts`, `theme.ts`, `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `backend/CLAUDE.md`, `story-generator.md`

### RevenueCat migration (2026-09-02)

- Replaced the prior billing client and webhook with RevenueCat Purchases, RevenueCatUI, a public Test Store SDK key placeholder, entitlement mapping, Customer Center, and server-side product/credit mapping.
- Added RevenueCat webhook handling with constant-time authorization, sandbox rejection by default, `rc:{event.id}` idempotency, trial grants, refund/chargeback handling, cancellation-versus-expiration behavior, and benign-event acknowledgement.
- Added bucketed credit accounting: renewable subscription grants reset each period, purchased and earned credits remain distinct while subscribed, chargebacks clamp and record shortfalls, and expiration records an atomic negative lapse ledger row before zeroing every bucket.
- Added the protected annual monthly-refresh Edge Function and focused Deno/PGlite tests. No deployment, dashboard configuration, commit, or push was performed.

### RevenueCat CodeRabbit fixes (2026-09-02)

- Corrected the webhook contract: only `CANCELLATION` events with RevenueCat's store-refund reasons invoke the clamped chargeback path; ordinary cancellation remains active until expiration, and `REFUND_REVERSED` re-grants credit.
- Made duplicate credit-operation responses successful webhook acknowledgements, paginated annual grant refreshes by user ID, and isolated per-subscriber refresh failures without logging identifiers.
- Hardened migration `00026` with a non-blocking validation sequence, provider allowlist, monotonic ledger ordering, allocation lookup index, and partial-refund bucket restoration.
- Added regression coverage for trial refunds, both product-kind mismatch directions, refund reversals, plain unsubscribe cancellations, and partial refunds. Local verification: `deno test --allow-all supabase/functions/_shared/revenuecat_test.ts supabase/migrations/00026_subscription_credit_buckets_test.ts` (14 passed) and `deno check` on changed Edge Function modules.
- Updated RevenueCat development-build setup and canonical-economy documentation. No production-level tests were run, so no `error_events` entry was required. No deployment, dashboard configuration, commit, or push was performed.
- Reconciled the Expo onboarding callback type with its declared empty-purpose state so the required Expo typecheck remains clean.

### RevenueCat CodeRabbit round 2 (2026-09-03)

- Counted duplicate annual-refresh operation keys as successful no-ops, leaving only genuine per-subscriber failures in the refresh failure counter.
- Made store-refund retries converge: a duplicate credit deduction now still records the subscription lifecycle state. Added a regression test for a failed first subscription write followed by a duplicate-deduction retry.
- Routed the onboarding sign-in action to the email/OTP flow, retained completion only on its `onDone` callback, and typed the composed onboarding wrapper with the exported result contract.
- Replaced inaccurate credits hero copy in English, Portuguese, and Spanish with neutral action-oriented wording while client spending remains unbundled.
- Local verification: Expo typecheck, lint (23 existing warnings, 0 errors), tests (41 passed), Expo doctor (18/18), a compiled 390 x 844 web sign-in handoff, backend tests (15 passed), and `deno check` on the changed Edge Functions. No production-level tests, deployment, dashboard configuration, commit, or push were performed; no `error_events` entry was required.

### RevenueCat migration — review, merge prep, and the ads decision (2026-09-03)

- Completed CodeRabbit rounds 2 and 3 on PR #44. Round 3 fixed a dead control:
  `presentCustomerCenter()` resolved silently on web and when the SDK never
  configured, so the caller's `catch` never fired and the Katha Plus row did
  nothing. It now reports whether it presented and the caller falls back to the
  paywall. Also corrected the Portuguese `heroDescription` accent.
- **Recorded every remaining RevenueCat task as blocked on the store listing**
  (`ROADMAP.md` Phase C, "Blocked on the store listing going live"): the 10 store
  products, the production `appl_`/`goog_` SDK keys, the `katha_reader` and
  `katha_writer` entitlements and offerings, wiring the paywall to live package
  data, scheduling the monthly grant refresh, the App Review question on lapsing
  purchased packs, and the development-build requirement. All dashboard work; the
  client and webhook are complete. A release build has no billing until the
  production keys are pasted in — `activate()` logs an error and returns.
- **Ads decision: none ship in the MVP.** Added `ROADMAP.md` Phase C2 and resolved
  §12 item 7 in `CREDITS_AND_PRICING.md`. A proposal to put a house-styled
  full-screen break between chapters on the free tier, so "read without
  interruptions" could be sold as a paid benefit, was rejected — house-styled means
  it earns nothing, so it was friction with no revenue attached, and §7 already
  cites the finding that users converting to remove friction churn faster than
  those converting for positive value. Principle 1 and the §7 "never block reading"
  rule are unchanged.
- Recorded the standing rule that until ads exist, no paywall, onboarding screen or
  store listing may claim "ad-free" or "no interruptions" as a paid benefit; a
  benefit that removes nothing is a misleading-subscription risk at App Review.
- **Process note.** A second agent was working in the same checkout on the same
  branch. Work was moved to an isolated git worktree at `/private/tmp/katha-rc-fix`
  so the shared tree was never written to; that agent's uncommitted edits to
  `CREDITS_AND_PRICING.md` and its new `STORY_GENERATION_FLOW.md` were left
  untouched. Two agents sharing one working tree should be avoided — use
  `git worktree add` instead.
- No production deployment was performed in this session. The two Supabase secrets
  `REVENUECAT_WEBHOOK_SECRET` and `SUBSCRIPTION_GRANT_CRON_SECRET` are set on
  `iafeuxgoiknncgyjmugd`.
