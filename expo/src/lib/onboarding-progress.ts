import type { OnboardingPurpose } from "@/types/domain";

/**
 * Where each onboarding screen sits on the progress row, by purpose.
 *
 * ONE PILL PER STEP, AND THE SAME ROW EVERYWHERE. The questionnaire used to
 * draw a filled track labelled `n/5`, and the character screens then drew a
 * different row of seven pills that opened already four in. Two rows, neither
 * of which counted the screens a person actually walked: a writer crossed ten
 * screens under seven pills, a reader eight under the same seven. This module
 * is the one place the count is written down, and both screens read it.
 *
 * WHAT COUNTS AS A STEP. Every question is a step. W3 (the character pitch) is
 * a step, because it has its own back and its own CTA. The making of the
 * character -- W4 Craft, W5 email, the code screen and W6 Meet -- is ONE step:
 * they are one ask ("make yourself a character") answered across four screens,
 * and a row that ticked through them would be measuring our email latency and
 * our image provider rather than the person's progress. The paywall draws no
 * row and WELCOME draws nothing.
 *
 * WHY THE COUNT DIFFERS BY PURPOSE. The purposes ask different questions: a
 * reader answers three after "Reading" (how, mood, when), a writer two
 * (format, blocker), and "both" two. Eight and seven are those screens counted
 * honestly. Before purpose is answered the row cannot know which, so the first
 * three screens draw the LONGEST row (`STEPS_BEFORE_PURPOSE`): a row that
 * loses a pill at step four for a writer is one reflow at the one moment the
 * person has just said something that changed the length, which reads as the
 * answer having mattered. A row that gained a pill for a reader would read as
 * the flow having found more to ask.
 */

/** The screens between the intro and the character flow, in walking order. */
export type QuestionStep =
  | "name"
  | "genres"
  | "purpose"
  /** Reader: "How do you like your stories?". Writer: format. Both: refine. */
  | "refine"
  /** Reader only: "What are you in the mood for?". */
  | "mood"
  /** Reader: "When do you usually read?". Writer: blocker. Both: moment. */
  | "moment";

export type OnboardingProgress = {
  /** How many pills the row draws. */
  total: number;
  /** Which pill each question screen lights. Absent when the purpose skips it. */
  question: Partial<Record<QuestionStep, number>>;
  /** The character pitch (W3). */
  w3: number;
  /** W4, W5, the code screen and W6, all on one pill. */
  character: number;
};

const SHARED: Pick<Record<QuestionStep, number>, "name" | "genres" | "purpose"> = {
  name: 1,
  genres: 2,
  purpose: 3,
};

const BY_PURPOSE: Record<OnboardingPurpose, OnboardingProgress> = {
  read: {
    total: 8,
    question: { ...SHARED, refine: 4, mood: 5, moment: 6 },
    w3: 7,
    character: 8,
  },
  write: {
    total: 7,
    question: { ...SHARED, refine: 4, moment: 5 },
    w3: 6,
    character: 7,
  },
  both: {
    total: 7,
    question: { ...SHARED, refine: 4, moment: 5 },
    w3: 6,
    character: 7,
  },
};

/**
 * What the first three screens draw, before anybody has said why they came.
 * The longest path, so the row can only ever shorten, and only once.
 */
export const STEPS_BEFORE_PURPOSE = Math.max(
  ...Object.values(BY_PURPOSE).map((progress) => progress.total),
);

export function onboardingProgress(
  purpose: OnboardingPurpose,
): OnboardingProgress {
  return BY_PURPOSE[purpose];
}

/**
 * The pill a question screen lights, and the row it sits on.
 *
 * `purpose` is empty until step three is answered, and the shared screens are
 * the same pill on every path, so the answer is well defined either way.
 */
export function questionStep(
  screen: QuestionStep,
  purpose: OnboardingPurpose | "",
): { steps: number; currentStep: number } {
  if (purpose === "") {
    return { steps: STEPS_BEFORE_PURPOSE, currentStep: SHARED[screen as keyof typeof SHARED] ?? 1 };
  }
  const progress = BY_PURPOSE[purpose];
  return {
    steps: progress.total,
    currentStep: progress.question[screen] ?? SHARED.purpose,
  };
}
