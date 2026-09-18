# Reviewing a Katha Original

You are the last reader before real readers. Each file in `backend/originals/review/`
is one story: the brief it was written from, then every chapter exactly as the app
will show it. Read every word of every story you are given. Do not skim.

## Judge it as a reader would
1. **Hook** - does chapter 1 make you want chapter 2 within its first page?
2. **Prose** - specific, concrete, alive? Flag AI tells: stock phrases ("a testament
   to", "the weight of", "hung in the air", "let out a breath she didn't know"),
   named emotions followed by their symptoms, every paragraph ending on a
   one-line zinger, characters explaining the theme, repeated images or phrases
   across chapters.
3. **Brief fidelity** - the cast's names, ages, looks and roles match the brief; the
   planned moments happen (or something better does); setting and era are right.
4. **Continuity** - names, facts, injuries, objects, timelines consistent across
   chapters; no chapter re-introduces a character as if new; no dropped threads.
5. **Arc** - each chapter moves; the last planned chapter is a real ending that pays
   off the setup (not a cliffhanger, not a summary).
6. **Craft glitches** - duplicate or generic chapter titles ("Chapter 3", two chapters
   with the same title), leftover markup/JSON, meta text ("In this chapter"),
   truncated endings, a chapter far shorter than its siblings.
7. **Safety & fit** - kids stories (audience kids) contain nothing frightening,
   cruel or unsafe to imitate, and educational ones teach only TRUE facts (check
   them). No real living people, brands or copyrighted characters. Historical
   and cultural detail is respectful and not wrong.

## Output
Append one JSON object per story (one per line) to the file you are told to write:
{"slug": "...", "verdict": "publish" | "fix" | "regenerate",
 "score": 1-10, "hook": 1-5, "prose": 1-5, "arc": 1-5,
 "issues": [{"chapter": n, "severity": "minor"|"major", "what": "...", "quote": "<=20 words"}],
 "fix": "for verdict fix: exactly which chapter(s) and what to change",
 "praise": "one line on what works best"}

- "publish": a paying reader would be glad they read it; only minor issues.
- "fix": good story with one or two chapters that need rewriting (a glitch, a
  continuity break, an unsafe or wrong detail, a weak ending).
- "regenerate": the story as a whole does not work.
Be demanding but fair; 7 is a good story, 9 is one you would recommend to a friend.

## Combined mode: review AND edit (when your task says so)
After writing the review line, if the verdict is "fix", ALSO write the fix itself,
following `backend/originals/EDIT_GUIDE.md` exactly, as one line in the edits
file you are told. You have already read every chapter, so use it: fix every
issue you listed, everywhere it occurs; retitle every duplicate or generic chapter
title; validate every `find` string occurs exactly once in its chapter (use a
small script) before you finish. A "publish" verdict may still carry small edits
(a typo, a duplicate title) - write those to the edits file too and keep the
verdict "publish".
