# Writing a chapter plan (`beats`) for a long Original

Long stories written chapter by chapter DRIFT: reviewers found backstories told
three incompatible ways, the same morning restarted three times, a scene repeated
four times, a clock that never ticks, a dead character found alive. The pipeline
accepts a per-chapter plan - `request.beats`, an array of strings - and tells the
model for chapter N: "this chapter must deliver its beat". Your plan is what keeps
the story coherent.

## Write, for each story you are given
Add `"beats": [...]` inside its `request` in its briefs file, with EXACTLY
`planned_chapter_count` entries, each <= 200 characters.

Each beat:
- names the ONE distinct event of that chapter (a new place, a new reveal, a new
  decision) - no two chapters may share a scene, setting-visit or reveal;
- advances time explicitly when time matters ("Day 3, dawn:"), so the clock moves;
- carries the fixed facts it depends on (names, ages, dates, who did what) so
  they cannot drift;
- escalates: stakes rise; the midpoint turns the story; the last beat is the
  ending that pays off the setup (never a cliffhanger, never a summary).
Beat 1 is the hook from the brief's topic. Use the brief's `moments` as anchors,
in order, spread across the run.

Also fix the story's "truth" once: if the story has a secret, backstory or
mystery solution, state it in beat 1 or 2 in words the reader will not see as
spoilers (e.g. "Ch1: ... (truth, revealed ch7: X did Y because Z)") so every
chapter is written from the same facts.

Kids stories: gentle escalation, no fright. Keep everything else in the brief
unchanged. After editing, run from /Users/mac16/Katha-AI-wt-onboarding:
    deno run --allow-read --allow-write --allow-env backend/originals/build-cover-prompts.ts --check
and make it pass. Edit only the briefs file(s) you are told, only the `beats`
(and, where a reviewer's notes say so, `moments`/`avoid`) of your stories.
