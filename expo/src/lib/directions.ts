/**
 * Turning the story's own state into DIRECTIONS THE READER GIVES.
 *
 * The chapter-end chips are derived from data the backend already wrote:
 * `story.beats`, `series_state.open_hooks`, `promised_payoffs`,
 * `next_chapter_pressure` and the chapter's `hook_text`. That data is real and
 * specific to the story -- but the model phrases hooks as QUESTIONS, because a
 * hook is a question by definition. Rendered straight, the chips read like a
 * comprehension quiz:
 *
 *     Who is writing the predictive linen notes
 *     What will happen if Anjali unfolds every sheet tomorrow
 *     Is the casualty girl Divya lying about having no brother
 *
 * which asks the reader to answer the story instead of steering it. A direction
 * is the same information pointed the other way:
 *
 *     Find out who is writing the predictive linen notes
 *     Show what happens if Anjali unfolds every sheet tomorrow
 *     Find out whether the casualty girl Divya is lying about having no brother
 *
 * THE RULE THAT GOVERNS THIS FILE: nothing is invented. Every word of a
 * direction comes from the story's own sentence plus a fixed English frame in
 * front of it. There is no template pool, no generic filler, and no
 * paraphrasing. A sentence this file cannot convert GRAMMATICALLY returns
 * `null` and the caller drops it, because a chip that could sit under any story
 * in the app advertises that the app read none of them -- the same reason
 * `deriveContinuationOptions` refuses to pad its list.
 *
 * The converter is deliberately high-precision and low-recall. Dropping a
 * usable hook costs one chip. Mangling one costs the reader's trust in every
 * chip.
 */

/**
 * Question openers this file can put an imperative frame in front of.
 *
 * `subjectCapable` marks the four that can be the SUBJECT of their own
 * question. "Who is writing the notes" is not inverted -- the frame goes
 * straight in front of it and the result is grammatical. "Why did Aaji stop
 * singing" IS inverted, and "Explain why did Aaji stop singing" is not
 * English, so an adjunct opener followed by an auxiliary is dropped instead.
 * See `isInverted` below.
 */
const WH_FRAMES: readonly (readonly [RegExp, string, boolean])[] = [
  // "Who is writing the notes" -> "Find out who is writing the notes".
  [/^who\b/i, "Find out who", true],
  [/^whose\b/i, "Reveal whose", true],
  [/^what\b/i, "Show what", true],
  [/^which\b/i, "Show which", true],
  [/^where\b/i, "Show where", false],
  [/^when\b/i, "Show when", false],
  [/^why\b/i, "Explain why", false],
  [/^how\b/i, "Show how", false],
];

/** Every auxiliary an inverted question can open with. */
const ANY_AUX =
  /^(is|are|was|were|am|do|does|did|will|would|can|could|should|shall|may|might|must|has|have|had)$/i;
/** Do-support only ever appears in an INVERTED question, never a subject one. */
const DO_AUX = /^(do|does|did)$/i;
const PRONOUN = /^(i|you|he|she|it|we|they|his|her|their|its|my|our|your)$/i;

/**
 * Whether the words after a wh- opener are subject-auxiliary inverted, and so
 * cannot take an imperative frame without being re-ordered.
 *
 * Three cases, in order:
 *  - No auxiliary at all -- nothing was inverted. "Who left the note."
 *  - Do-support -- always inverted. "What did she find." Dropped.
 *  - Another auxiliary followed by a pronoun -- inverted. "What is she doing."
 *    Followed by anything else, the wh- word is the subject and the auxiliary
 *    belongs to it: "Who is writing the notes."
 */
function isInverted(rest: string, subjectCapable: boolean): boolean {
  const [first = "", second = ""] = rest.split(/\s+/);
  if (!ANY_AUX.test(first)) return false;
  if (!subjectCapable) return true;
  if (DO_AUX.test(first)) return true;
  return PRONOUN.test(second);
}

/**
 * The auxiliaries a yes/no question can be un-inverted around without knowing
 * anything about the verb that follows.
 *
 * Only forms of BE are here. "Is X lying" inverts to "whether X is lying" by
 * moving one word, because the participle after it is unchanged. "Does X know"
 * would have to become "whether X knows", which means conjugating a verb this
 * file has no business guessing at, so DO/DOES/DID questions are dropped
 * instead of mangled.
 */
const BE_AUX = /^(is|are|was|were)\s+/i;

/**
 * Where the subject of a be-question ends: the first participle-shaped word.
 *
 * "Is | the casualty girl Divya | lying about having no brother" -- the subject
 * is everything before "lying". An "-ing" or "-ed" word is a reliable enough
 * anchor for the prose these hooks are written in; when there is none, the
 * question is dropped rather than split at a guess.
 */
const PARTICIPLE = /^[\p{L}]+(ing|ed)$/u;

/**
 * A pressure line's modal, which hands back a bare verb for free.
 *
 * "Anjali must decide whether to burn them" -> "Have Anjali decide whether to
 * burn them". The verb after a modal is already uninflected, so this is a
 * deletion, not a conjugation.
 */
const MODAL_CLAUSE =
  /^(.{2,80}?)\s+(?:must|should|needs to|need to|has to|have to)\s+(.+)$/i;

/**
 * Sentences that already tell the story what to do are left exactly as they
 * are. The list is imperative verbs, not a phrase pool -- it decides whether to
 * touch a sentence, it never supplies one.
 */
const ALREADY_IMPERATIVE =
  /^(ask|take|show|find|tell|send|bring|make|let|follow|reveal|confront|return|give|have|push|write|open|keep|put|meet|explain|settle|break|leave|play|end|start|begin|force|pull|draw|set|turn|hold|get)\b/i;

function tidy(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/[?.!]+$/, "").trim();
}

/**
 * Words that are only ever capitalised because they started a sentence.
 *
 * A CLOSED LIST, and it has to stay one. The alternative -- lower-casing any
 * leading capital that is not obviously an acronym -- turns "Anjali must decide"
 * into "Have anjali decide", which is the app misspelling the reader's own
 * character's name on a card they are being asked to buy. Leaving a stray
 * capital mid-sentence is a typographic blemish; renaming a character is not.
 */
const SENTENCE_OPENERS = new Set([
  "the", "a", "an", "this", "that", "these", "those", "his", "her", "their",
  "its", "our", "your", "my", "he", "she", "it", "they", "we", "you",
  "someone", "somebody", "nobody", "everyone", "everybody", "one", "both",
  "neither", "either", "no", "another", "every", "each", "all", "some",
]);

/** Lower-cases a leading capital only when the word cannot be a name. */
function decapitalise(value: string): string {
  if (!value) return value;
  const first = value.split(/\s+/)[0] ?? "";
  if (!SENTENCE_OPENERS.has(first.toLowerCase())) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function finish(value: string): string {
  const trimmed = tidy(value);
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
}

/**
 * One line of story state as an imperative direction, or `null` when it cannot
 * be made into one without inventing words.
 */
export function toDirection(source: string | undefined | null): string | null {
  const text = tidy(source ?? "");
  if (text.length < 8) return null;

  if (ALREADY_IMPERATIVE.test(text)) return finish(text);

  // "What will happen if Anjali unfolds every sheet" -- taken before the
  // generic What frame, because "Show what will happen if..." is a mouthful and
  // "Show what happens if..." says the same thing in a reader's voice.
  const whatHappens = text.match(/^what\s+(?:will|would)\s+happen\s+(if|when|once|after)\s+(.+)$/i);
  if (whatHappens) return finish(`Show what happens ${whatHappens[1].toLowerCase()} ${whatHappens[2]}`);

  for (const [opener, frame, subjectCapable] of WH_FRAMES) {
    if (opener.test(text)) {
      const rest = text.replace(opener, "").trim();
      if (rest.length < 4) return null;
      if (isInverted(rest, subjectCapable)) return null;
      return finish(`${frame} ${decapitalise(rest)}`);
    }
  }

  const be = text.match(BE_AUX);
  if (be) {
    const aux = be[1].toLowerCase();
    const rest = text.slice(be[0].length).trim();
    const words = rest.split(/\s+/);
    const pivot = words.findIndex((word) => PARTICIPLE.test(word));
    // A pivot at 0 would leave no subject to put the auxiliary after.
    if (pivot > 0) {
      const subject = words.slice(0, pivot).join(" ");
      const predicate = words.slice(pivot).join(" ");
      return finish(`Find out whether ${decapitalise(subject)} ${aux} ${predicate}`);
    }
    return null;
  }

  const modal = text.match(MODAL_CLAUSE);
  if (modal) return finish(`Have ${decapitalise(modal[1])} ${modal[2]}`);

  // Anything still ending in a question mark, or opening with an auxiliary this
  // file will not un-invert, is dropped rather than guessed at.
  if (/[?]$/.test(tidy(source ?? "")) || /^(do|does|did|will|would|can|could|should|has|have|had|am)\b/i.test(text)) {
    return null;
  }

  /*
    A plain declarative clause -- a planned beat ("Anjali confronts her mother
    about the notes"), a promised payoff, a closing hook written as a statement.

    "Write it so ..." is the one frame that turns ANY third-person clause into
    an instruction without touching a verb, a tense or a pronoun. It is not
    filler: every word after it is the story's own, and without it the chip
    would be a description of the chapter rather than a request for it.
  */
  return finish(`Write it so ${decapitalise(text)}`);
}
