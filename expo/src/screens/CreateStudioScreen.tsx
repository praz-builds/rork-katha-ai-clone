import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import CreateBriefFlow from "@/components/create/CreateBriefFlow";
import {
  type GenerationSession,
  startStoryGeneration,
} from "@/lib/generation-session";
import { loadDraft, saveDraft } from "@/lib/draft-storage";
import { MAX_CAST_SIZE, STORY_START_CREDITS } from "@/lib/pricing-limits";
import { formatCredits } from "@/lib/pricing";
import type {
  AudienceMode,
  CreateDraft,
  Genre,
  IdentityLens,
  PlannedChapterCountOffer,
  SpiceLevel,
} from "@/types/domain";

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

/**
 * The studio has ONE step now, and that is the whole point of it.
 *
 * It used to have five: `setup`, `generating`, `editor`, `review` and
 * `publishing`. A writer finished a brief, waited, and then landed in a
 * paragraph-by-paragraph editor with AI rewrite chips, a chapter tab strip, a
 * "Write the rest" run, a cover review card and a Publish button - a small
 * desktop word processor, reached by everybody, whether or not they wanted to
 * edit anything, before they had read a word of their own story.
 *
 * The product decision (2026-09-09) is that generation ends in the READER. You
 * write a brief, and the reader opens: on the crafting screen while there is
 * nothing to read yet, then on page 1 of your story as soon as whole finished
 * pages exist, with the rest arriving behind you. Editing is a notepad reached
 * from the reader's chrome when you want it; publishing is the "Make it public"
 * toggle in the brief, applied the moment the chapter lands; continuing is the
 * chapter end.
 *
 * So this screen is the brief and the handoff, and nothing else. The generation
 * it starts lives in `@/lib/generation-session` - outside React, because it has
 * to outlive this screen - and the reader that shows it is rendered by `App`.
 */

type DraftCharacter = {
  name: string;
  isHero: boolean;
  /** Voice, motivation, relationships. Drives the prose, never the portrait. */
  background?: string;
  /**
   * Who they are and what they look like. Drives the prose, the cover and the
   * portrait. One field: Craft used to ask for a Description beside this and
   * the two said the same thing to different prompts.
   */
  appearance: string;
  portraitUrl?: string;
  portraitStatus?: "idle" | "generating" | "ready" | "failed";
  /**
   * The `user_characters` row this character came from, when the writer picked
   * them out of their saved library rather than writing a new one. Lets the
   * server reuse the stored appearance and a portrait already paid for, and
   * lets tapping the same chip again remove exactly this row.
   */
  savedCharacterId?: string;
};

export type StudioDraft = {
  primaryGenre: Genre;
  genres?: Genre[];
  audienceMode: AudienceMode;
  spiceLevel: SpiceLevel;
  identityLenses: IdentityLens[];
  seed: string;
  language: CreateDraft["language"];
  /** Private by default. Applied the moment chapter one exists. */
  visibility: NonNullable<CreateDraft["visibility"]>;
  characters: DraftCharacter[];
  isSeries: boolean;
  whereAndWhen?: string;
  moments?: string[];
  storyValues?: string[];
  writingStyle?: string;
  avoid?: string;
  chapterLength?: "short" | "standard" | "long";
  plannedChapterCount?: PlannedChapterCountOffer;
  illustrateChapters?: boolean;
  imageStyle?: CreateDraft["imageStyle"];
  storyFlow?: CreateDraft["storyFlow"];
  /**
   * The chapter plan, and with it the opening the writer chose.
   *
   * Shaping produces it on the direction step and `beats[0]` is chapter one's
   * brief, so a chosen direction travels as beat zero. It was missing from
   * this screen's `createDraft` entirely, which meant the plan the writer was
   * shown and the story they received were unrelated.
   */
  beats?: string[];
  /**
   * Grounding resolved during onboarding, carried through to generation.
   *
   * Shaping resolves these for free while the writer edits chips, so a draft
   * that arrives from onboarding already has them. Dropping them here would
   * make the paid generation re-derive what has already been paid for -- or,
   * past its tighter fallback deadline, lose it entirely, silently, because
   * `api.ts` forwards these only when present.
   */
  grounding?: unknown[];
  groundingEntities?: unknown[];
};

type CreateStudioProps = {
  credits: number;
  isAnonymous?: boolean;
  /**
   * The generation has started. The caller opens the reader on it.
   *
   * Called the instant the request is away, not when the story is finished:
   * the reader is where the whole wait happens now - the crafting screen while
   * there is nothing to read, then page 1 the moment there is. Nothing about
   * the outcome is reported here, because the session reports it to everybody
   * at once through the store.
   */
  onGenerationStarted: (session: GenerationSession) => void;
  onBack: () => void;
  /**
   * The blueprint a user built during onboarding.
   *
   * It arrives as a draft rather than as a story, and the user still presses
   * Create themselves. Generating on arrival would spend their whole welcome
   * grant on a story they have not asked for a second time and may never open.
   */
  initialDraft?: Partial<StudioDraft>;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CHARACTERS = MAX_CAST_SIZE;

const INITIAL_DRAFT: StudioDraft = {
  primaryGenre: "fantasy",
  audienceMode: "adult",
  spiceLevel: "sweet",
  identityLenses: [],
  seed: "",
  language: "English",
  // No phantom character.
  //
  // This seeded one blank `{ name: "", appearance: "" }` row, which the client
  // sent verbatim. `validation.ts` rejects any supplied character without a
  // name, so every user who did not fill in a cast -- the common case, since
  // characters are optional -- got a 400 on the primary path. The cast starts
  // empty; `addCharacter` creates the first row.
  characters: [],
  isSeries: true,
  chapterLength: "standard",
  plannedChapterCount: 3,
  illustrateChapters: false,
  // The genre decides the art, and the writer decides what happens next.
  // Both are named rather than left absent so the controls open on a real
  // value instead of on their own label.
  imageStyle: "auto",
  storyFlow: "interactive",
  // Public by default: everyone reaching Create has signed in with email, and
  // the server still forces a story private when the entity gate says so.
  visibility: "public",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CreateStudioScreen({
  credits,
  isAnonymous = true,
  onGenerationStarted,
  onBack,
  initialDraft,
}: CreateStudioProps) {
  const [draft, setDraft] = useState<StudioDraft>(() =>
    initialDraft ? { ...INITIAL_DRAFT, ...initialDraft } : INITIAL_DRAFT
  );
  // Restore persisted draft on mount
  const draftRestoredRef = useRef(false);
  useEffect(() => {
    // An onboarding blueprint outranks anything in AsyncStorage: the user built
    // it seconds ago, and restoring over it would silently discard the whole
    // reason they finished the flow.
    if (initialDraft) {
      draftRestoredRef.current = true;
      return;
    }
    loadDraft()
      .then((saved) => {
        if (!saved) return;
        const restored = saved as StudioDraft;

        // `saved` comes from AsyncStorage and is typed by assertion only, so
        // nothing guarantees `characters` is an array. A draft written by an
        // older build, or a partially written one, can omit it - and reading
        // .length off undefined here would reject the promise before
        // draftRestoredRef is set, leaving auto-save disabled for the whole
        // mount and silently discarding everything the user then types.
        const characters = Array.isArray(restored.characters)
          ? restored.characters
          : [];

        // The cap also moved: it was 5 before MAX_CHARACTERS came down to 3, so
        // an older draft can hold more than the server will accept. Clamp on
        // the way in rather than letting Create take a 400.
        setDraft({
          ...restored,
          characters: characters.slice(0, MAX_CHARACTERS),
          // KIDS MODE IS NOT RESTORED.
          //
          // Everything else in a draft is work in progress worth getting
          // back: the idea, the premise, the cast, the moments. Kids Mode is
          // not work, it is a decision about who a story is FOR, and it
          // changes what gets written -- the genre list shrinks, spice is
          // forced to sweet, the length changes, the content rating changes.
          //
          // Restoring it silently, up to seven days after it was set, means
          // opening Create and finding the switch already on with no memory
          // of turning it on. The owner reported exactly that and read it as
          // the app guessing. A brief that arrives pre-decided about its
          // audience is a guess, however it got there.
          //
          // The cost of this choice, stated plainly: someone part-way through
          // composing a children's story who reloads has to turn it back on.
          // They will see that they need to -- it is the first control on the
          // screen and it is now legible -- whereas the reverse mistake is
          // invisible until the story comes back wrong.
          //
          // And everything Kids Mode DERIVED goes with it. `chooseAudience`
          // forces `spiceLevel` to sweet and `chapterLength` to short when the
          // switch goes on, and `storyValues` exists only for kids. Resetting
          // the switch alone would leave those behind, and the next generation
          // would quietly send a short, sweet, values-laden brief as an adult
          // story -- a half-reverted setting is worse than either state.
          audienceMode: INITIAL_DRAFT.audienceMode,
          ...(restored.audienceMode === "kids"
            ? {
              spiceLevel: INITIAL_DRAFT.spiceLevel,
              chapterLength: INITIAL_DRAFT.chapterLength,
              storyValues: [],
            }
            : {}),
        });
      })
      .finally(() => {
        // Always, even if the stored draft was unreadable. Otherwise a single
        // bad payload disables auto-save until the app restarts.
        draftRestoredRef.current = true;
      });
    // Runs once. `initialDraft` is fixed for the life of the mount, and a
    // re-run would restore over whatever the user has typed since.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save draft on changes (debounced 500ms, blocked until restore completes)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!draftRestoredRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveDraft(draft);
    }, 500);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [draft]);

  // One non-whitespace character, matching validation.ts. The 40-character gate
  // is gone: it taught padding rather than structure, and a one-line idea is a
  // legitimate choice per source-of-truth/STORY_GENERATION_FLOW.md section 2.
  const canGenerate = draft.seed.trim().length >= 1
    && credits >= STORY_START_CREDITS;

  const startedRef = useRef(false);
  // No entity warning in front of this any more. It used to stop a public
  // request whose idea named a real person and offer "Keep it private"; the
  // server-side gate it previewed was removed on 2026-09-18 (migration
  // 00091), so the toggle means what it says and generation simply starts.
  const handleGenerate = useCallback((options?: {
    choice?: { direction?: string; beats?: string[] };
  }) => {
    // Synchronous, and first: two presses in the same tick must not each start
    // a generation, because each one reserves and spends credits.
    if (startedRef.current) return;
    const choice = options?.choice;
    /*
      What the writer is actually asking for, which for a guest is not what
      the draft says.

      The brief's toggle defaults to Public now, and a guest's toggle is
      DISPLAYED as private and disabled (`CreateBriefFlow`) without the draft
      ever being written back. So the draft of a guest who never touched the
      control still said "public", and the request said public while the
      screen said Private. The server applies `account_required` and makes it
      private either way, so nothing broke -- it was the question that was
      wrong.
    */
    const requestedVisibility = isAnonymous ? "private" : draft.visibility;
    if (!canGenerate) {
      Alert.alert(
        credits >= STORY_START_CREDITS ? "Add a story seed" : "Credits needed",
        credits >= STORY_START_CREDITS
          ? "Give Katha one clear idea to shape."
          : `You need ${formatCredits(STORY_START_CREDITS)} to start a story.`,
      );
      return;
    }

    const createDraft: CreateDraft = {
      primaryGenre: draft.primaryGenre,
      genres: draft.genres,
      audienceMode: draft.audienceMode,
      spiceLevel: draft.spiceLevel,
      identityLenses: draft.identityLenses,
      seed: draft.seed,
      language: draft.language,
      visibility: requestedVisibility,
      // Belt and braces with the clamp in loadDraft: validation.ts enforces the
      // same cap, and a request over it is a 400 rather than a truncation.
      characters: draft.characters.slice(0, MAX_CHARACTERS),
      isSeries: draft.isSeries,
      whereAndWhen: draft.whereAndWhen,
      moments: draft.moments,
      storyValues: draft.storyValues,
      writingStyle: draft.writingStyle,
      avoid: draft.avoid,
      chapterLength: draft.chapterLength,
      plannedChapterCount: draft.plannedChapterCount,
      illustrateChapters: draft.illustrateChapters,
      imageStyle: draft.imageStyle,
      storyFlow: draft.storyFlow,
      // The plan shaping produced on the direction step, with the writer's
      // chosen opening as chapter one's beat. Nothing is invented here: with
      // no direction chosen the plan travels exactly as it was shaped, and
      // with no plan at all the direction stands alone as beat zero.
      beats: choice?.direction
        ? [choice.direction, ...(choice.beats ?? draft.beats ?? []).slice(1)]
        : choice?.beats ?? draft.beats,
      // Carried through from onboarding, where shaping already resolved it for
      // free. Omitting them here meant the paid generation arrived ungrounded
      // and re-derived what had already been paid for -- or, past the fallback
      // deadline, simply lost it. `api.ts` forwards these only when present, so
      // dropping them was silent.
      grounding: draft.grounding,
      groundingEntities: draft.groundingEntities,
    };

    startedRef.current = true;
    onGenerationStarted(startStoryGeneration({ draft: createDraft }));
  }, [canGenerate, credits, draft, isAnonymous, onGenerationStarted]);

  return (
    <CreateBriefFlow
      credits={credits}
      isAnonymous={isAnonymous}
      draft={draft}
      setDraft={setDraft}
      onGenerate={(choice) => handleGenerate({ choice })}
      onBack={onBack}
    />
  );
}
