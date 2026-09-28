/**
 * Shared tradition (faith) contract.
 *
 * The FAITH axis of a story world. It is deliberately separate from, and never
 * derived from, the COUNTRY axis in `story-world-countries.ts`:
 *
 *   country  = culture  (where the names, food, idiom and streets come from)
 *   tradition = faith   (whose practice, address and depiction rules apply)
 *
 * They are independent because people are. `IN` + `hindu`, `IN` + `muslim`,
 * `IN` + `christian`, `JP` + `buddhist`, `JP` + `shinto` and `US` + `jewish`
 * are all ordinary households, and inferring either axis from the other would
 * erase every one of them. Nothing in this module reads a country code, and
 * nothing in the country contract reads a tradition id. `WorldPreference`
 * below is the only place the two meet, and it holds them side by side.
 *
 * Like the country table this is checked in rather than derived: every phrase
 * that can reach a prompt is written here, by us, and selected by a closed-list
 * id. Nothing a client sends is ever interpolated into prose.
 *
 * This module is pure data plus pure functions. Keep it free of Deno, React and
 * platform APIs so the client can import it directly if a picker is ever built.
 *
 * WHAT THIS MODULE DOES NOT DO: it does not build prompt blocks and it does not
 * build image prompts. It is the contract those two layers read. See "Notes for
 * the prompt and image layers" at the foot of the file.
 */

import type { CountryCode } from "./story-world-countries.ts";

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/**
 * Every tradition id the system will ever recognise, including the ones no
 * deploy yet writes stories for.
 *
 * Ids are declared ahead of support on purpose. A client that ships a picker
 * before the backend ships the policy sends `buddhist`; declaring the id here
 * means we can log it, count it and normalise it away deliberately, rather than
 * treating it as a typo. `isTraditionId` answers "is this a name we know";
 * `isSupportedTradition` answers "may this reach a prompt". Only the second
 * question gates behaviour.
 */
export type TraditionId =
  | "christian"
  | "muslim"
  | "jewish"
  | "hindu"
  | "buddhist"
  | "sikh"
  | "jain"
  | "shinto"
  | "daoist"
  | "bahai"
  | "zoroastrian"
  | "indigenous"
  | "african_traditional"
  | "secular";

/**
 * The traditions Phase 1 carries a complete, reviewed representation policy
 * for. Anything outside this union normalises to absent.
 */
export type SupportedTraditionId = "christian" | "muslim" | "jewish" | "hindu";

// ---------------------------------------------------------------------------
// Depiction policy
// ---------------------------------------------------------------------------

/**
 * Whether a class of figure may be drawn at all.
 *
 * An enum rather than a boolean because "not as a person" is a real third
 * answer and the commonest one: a tradition can welcome a picture of the scene
 * while forbidding the figure in it. `symbolic` means the figure may be
 * present in the image only as light, absence, an object or a pattern — never
 * as a body.
 */
export type DepictionRule = "forbidden" | "symbolic" | "allowed";

/**
 * A cautious reading a family may hold that widens a narrate-only rule.
 *
 * Encoded as data with an explicit default rather than as prose, because the
 * prompt layer has to be able to ask "is this figure narrate-only" and get a
 * boolean, and because a future account-level setting has to be able to flip
 * one without an edit to the prose.
 */
export type DepictionExtension = {
  readonly id: string;
  readonly label: string;
  /**
   * Phase 1 default. `true` means the extension is APPLIED — the wider,
   * more cautious reading — which is what every extension here ships as.
   */
  readonly appliedByDefault: boolean;
  readonly rationale: string;
};

/**
 * Who may be shown, who may only be told, and what the picture shows instead.
 *
 * Booleans and enums, never prose, so the image layer can branch on it and the
 * test suite can assert on it. The prose that reaches a prompt is assembled by
 * the prompt layer from these fields plus `narrationRules`.
 */
export type DepictionPolicy = {
  /** May the Divine be visually depicted. See DIVINE_DEPICTION_CONFLICT. */
  readonly divine: DepictionRule;
  /** May prophets, messengers and founders be visually depicted. */
  readonly prophets: DepictionRule;
  /** May other sacred figures (saints, sages, companions, avatars) be depicted. */
  readonly otherSacredFigures: DepictionRule;
  /**
   * Whether a face may be rendered for any figure this policy permits at all.
   * `false` is absolute: it outranks `allowed` above, so a tradition can permit
   * a figure's presence and still forbid their face.
   */
  readonly facesPermittedForSacredFigures: boolean;
  /**
   * Figure classes that are NARRATED ONLY: never rendered in any image, and
   * never given dialogue, an inner voice, or a line attributed to them by a
   * character. Narration may describe what they did and what it meant.
   */
  readonly narrateOnly: readonly string[];
  /**
   * What the picture holds instead of the forbidden figure. Server-owned
   * phrases, handed to the image layer verbatim.
   */
  readonly visualSubstitutes: readonly string[];
  /** Cautious readings that widen `narrateOnly`; see DepictionExtension. */
  readonly extensions: readonly DepictionExtension[];
};

// ---------------------------------------------------------------------------
// Scripture policy
// ---------------------------------------------------------------------------

/**
 * PHASE 1, EVERY TRADITION: no direct scriptural quotation. Ever.
 *
 * A language model asked for "the verse about kindness" produces a fluent,
 * correctly-formatted, confidently-referenced verse that does not exist, or
 * exists with different words, or exists in a different chapter. In a bedtime
 * story handed to a child as their own tradition's words, that is the worst
 * failure this product can commit — worse than a flat story, worse than no
 * story. It is not a quality problem; a misquoted scripture is a fabricated
 * one.
 *
 * So scripture is either ABSENT, or PARAPHRASED AND LABELLED as a retelling in
 * the narration itself, so a listening parent hears that it is our words and
 * not the text's. Direct quotation becomes possible only when a verified source
 * file with a chapter-and-verse reference exists and the quote is copied from
 * it. That file does not exist. Until it does, quotation is off.
 *
 * `directQuotationAllowed` is typed as the literal `false`, not `boolean`, so
 * this cannot be configured away by accident: a tradition entry that sets it
 * `true` fails `deno check` rather than shipping.
 */
export type ScripturePolicy = {
  /** Server-owned names for this tradition's texts, for the prompt layer. */
  readonly namedTexts: readonly string[];
  /** Always `false` in Phase 1, and unrepresentable as `true` by type. */
  readonly directQuotationAllowed: false;
  /** Paraphrase is permitted, and only when labelled. */
  readonly paraphraseAllowed: boolean;
  /** Always `true`: an unlabelled paraphrase reads as a quotation. */
  readonly paraphraseMustBeLabelled: true;
  /**
   * The server-owned phrasing the narration uses to mark a paraphrase, e.g.
   * "the story is told that...". Never client text.
   */
  readonly retellingLabels: readonly string[];
  /**
   * Path to the verified quotation source file, or `null` while none exists.
   * The prompt layer must treat `null` as "quotation impossible", not as
   * "quotation unrestricted".
   */
  readonly verifiedSourceFile: string | null;
};

/**
 * The scripture rule stated once, in the words the prompt layer should use.
 *
 * It applies to every tradition identically, so it lives here rather than being
 * copied into four entries where three could drift.
 */
export const UNIVERSAL_SCRIPTURE_RULES: readonly string[] = Object.freeze([
  "Never quote scripture directly. Do not produce any verse, line, ayah, passage or reference from any sacred text, in any language, even if asked and even if you are confident you know it.",
  "Do not invent a chapter, verse or section number, and do not attribute a sentence to a sacred text.",
  "If the story needs what a text teaches, retell it in your own plain words and mark it as a retelling in the narration itself, so a listener hears that these are the storyteller's words.",
]);

/** Phase 1 has no verified quotation source, so there is nothing to quote from. */
export const VERIFIED_SCRIPTURE_SOURCE_FILE = null;

// ---------------------------------------------------------------------------
// The tradition record
// ---------------------------------------------------------------------------

export type Tradition = {
  readonly id: TraditionId;
  /** Human-facing name. Not for prompts — see `promptName`. */
  readonly label: string;
  /**
   * The phrase the prompt layer puts in prose. Server-owned, always. No client
   * string may ever be substituted here.
   */
  readonly promptName: string;
  /**
   * Whether Phase 1 writes stories for this tradition. `false` entries exist so
   * an id can be recognised and normalised away deliberately.
   */
  readonly supported: boolean;
  readonly depiction: DepictionPolicy;
  /**
   * How the Divine is named aloud in storytelling, when a tradition has a
   * customary spoken form that differs from the generic word — e.g. many
   * Jewish families say "Hashem" rather than the name. `null` where there is no
   * single customary substitution, which is not the same as "use anything".
   */
  readonly divineAddress: string | null;
  readonly scripturePolicy: ScripturePolicy;
  /** Server-owned prose constraints for the narration. */
  readonly narrationRules: readonly string[];
  /**
   * The shallow visual shortcuts not to lean on. A tradition is not a building,
   * a garment and a symbol; a story that reaches for those three has drawn a
   * stock photo of a faith instead of a family inside one.
   */
  readonly avoidStereotypes: readonly string[];
  readonly notes?: string;
  /**
   * Claims in this entry that need a person from inside the tradition to
   * confirm before we ship them as if they were settled. Non-empty is not a
   * blocker; it is an honest queue.
   */
  readonly sourceNeeded?: readonly string[];
};

/**
 * ============================================================================
 * DIVINE_DEPICTION_CONFLICT — read before changing any `divine:` value below.
 * ============================================================================
 *
 * The founder has given two instructions that contradict each other, and this
 * file does not get to pick one quietly.
 *
 *   WRITTEN:  "Never depict God."
 *   BY VOICE: depicting the divine on a cover is acceptable for Hindu and for
 *             Christian traditions.
 *
 * Both are recorded here verbatim because the resolution is a product and a
 * religious-representation decision, not an engineering one.
 *
 * PHASE 1 DEFAULT: the CONSERVATIVE reading. `divine` is `forbidden` for every
 * tradition, including Hindu and Christian. The asymmetry of the mistake
 * decides it: a cover that omits a depiction nobody objects to disappoints
 * quietly and can be regenerated; a cover that depicts what a family holds must
 * not be depicted is a harm we cannot take back from them, and they will have
 * paid us for it.
 *
 * HINDU IS THE LIKELIEST FIRST RELAXATION, and it is worth saying why the
 * default is still off there. Depicting deities is entirely normal in Hindu
 * devotional and children's art — a Ganesha or a Krishna on a children's book
 * cover is unremarkable and often expected, and the conservative default is
 * arguably *less* faithful to the tradition than the permissive one would be.
 * It ships off anyway because an image model asked for a deity produces
 * iconography with the wrong attributes, the wrong vahana, the wrong number of
 * arms, and a face that reads as generic fantasy art — a devotional error
 * rather than a rendering one. Relaxing it needs the founder's decision AND a
 * reviewed iconography spec, not just the flag.
 *
 * CHANGING THIS IS A ONE-LINE EDIT per tradition: set `divine` to `symbolic` or
 * `allowed` in that tradition's entry. It is deliberately not behind a runtime
 * flag, an env var or a request field — a decision this consequential should
 * arrive as a reviewed diff with a name on it, and be visible in `git blame`.
 *
 * AWAITING: the founder's explicit written resolution of the two instructions
 * above. Until it arrives, do not change these values.
 */
export const DIVINE_DEPICTION_CONFLICT = Object.freeze({
  written: "Never depict God.",
  spoken:
    "Depicting the divine on a cover is acceptable for Hindu and for Christian traditions.",
  resolved: false,
  phase1Default: "forbidden" as const,
  reason:
    "Unresolved conflict between a written rule and a spoken exception; Phase 1 takes the conservative reading for every tradition.",
});

/** The paraphrase labels every tradition shares. Server-owned phrasing. */
const RETELLING_LABELS: readonly string[] = Object.freeze([
  "the story is told that",
  "as the story has been told in this family",
  "people have told it this way",
]);

function scripture(
  namedTexts: readonly string[],
): ScripturePolicy {
  return {
    namedTexts: Object.freeze([...namedTexts]),
    // Phase 1: off everywhere, and typed so it cannot be turned on by edit.
    directQuotationAllowed: false,
    paraphraseAllowed: true,
    paraphraseMustBeLabelled: true,
    retellingLabels: RETELLING_LABELS,
    verifiedSourceFile: VERIFIED_SCRIPTURE_SOURCE_FILE,
  };
}

/** A declared-but-unsupported id: recognised, never written for, no policy. */
function declared(id: TraditionId, label: string): Tradition {
  return {
    id,
    label,
    promptName: label,
    supported: false,
    depiction: {
      // Unsupported traditions never reach a prompt, so these values are never
      // read. They are the conservative ones anyway: if support is added by
      // flipping `supported`, the failure mode is a dull cover, not a harmful
      // one.
      divine: "forbidden",
      prophets: "forbidden",
      otherSacredFigures: "forbidden",
      facesPermittedForSacredFigures: false,
      narrateOnly: Object.freeze([]),
      visualSubstitutes: Object.freeze([]),
      extensions: Object.freeze([]),
    },
    divineAddress: null,
    scripturePolicy: scripture([]),
    narrationRules: Object.freeze([]),
    avoidStereotypes: Object.freeze([]),
    notes:
      `Id declared so a newer client sending "${id}" can be recognised and normalised away deliberately rather than read as a typo. No reviewed representation policy exists yet, so it normalises to absent and the story is written exactly as if no tradition had been set.`,
    sourceNeeded: Object.freeze([
      `A complete representation policy for ${label}, written with a person from inside the tradition, before \`supported\` is flipped to true.`,
    ]),
  };
}

export const TRADITIONS = {
  // -------------------------------------------------------------------------
  christian: {
    id: "christian",
    label: "Christian",
    promptName: "a Christian family's tradition",
    supported: true,
    depiction: {
      // See DIVINE_DEPICTION_CONFLICT above before changing this line.
      divine: "forbidden",
      prophets: "symbolic",
      otherSacredFigures: "allowed",
      facesPermittedForSacredFigures: true,
      narrateOnly: Object.freeze(["God", "the Holy Spirit"]),
      visualSubstitutes: Object.freeze([
        "light through a window or across a floor",
        "an open field, a hillside, a shoreline at dawn",
        "hands, bread, a lamp, a wooden door, a stone step",
        "the architecture and the weather of the place",
      ]),
      extensions: Object.freeze([]),
    },
    divineAddress: null,
    scripturePolicy: scripture(["the Bible", "the Gospels", "the Psalms"]),
    narrationRules: Object.freeze([
      "Write a family who live inside this tradition, not a lesson about it. Faith shows in what they do on an ordinary evening.",
      "Prayer, grace before a meal and going to church may appear as ordinary family life, described plainly and without commentary.",
      "Do not resolve the story by a miracle. What changes should change through a character's choice.",
      "Do not give the story a moral in the last line. Let the ending mean what it means.",
      "Never write a line of dialogue for God or the Holy Spirit, and never narrate their inner thoughts.",
      "Do not name a denomination unless the brief does.",
    ]),
    avoidStereotypes: Object.freeze([
      "reducing the tradition to a church building, a cross and a Bible on a table",
      "a stained-glass window as shorthand for belief",
      "the American suburban megachurch as the default setting for every Christian family",
      "an all-white cast: this is the world's most geographically spread tradition",
      "piety as a personality — a child who only ever speaks in devotional register",
    ]),
    notes:
      "Depiction of saints and of named biblical people other than God is broadly accepted across most Christian traditions, though some Reformed and Anabaptist communities avoid religious imagery of any kind. `prophets: symbolic` is the cautious middle: the scene without the face.",
    sourceNeeded: Object.freeze([
      "Confirm with clergy or practitioners across at least Catholic, Orthodox, mainline Protestant and evangelical backgrounds whether `otherSacredFigures: allowed` is safe as a default, or whether it should start at `symbolic` too.",
      "Whether Jesus should be modelled as `prophets` (current) or as `divine`; the traditions differ, and the founder's conflict above bears directly on it.",
    ]),
  },

  // -------------------------------------------------------------------------
  muslim: {
    id: "muslim",
    label: "Muslim",
    promptName: "a Muslim family's tradition",
    supported: true,
    depiction: {
      // See DIVINE_DEPICTION_CONFLICT above before changing this line. This one
      // is not in tension with anything: no Muslim tradition permits it.
      divine: "forbidden",
      // HARD RULE: prophets are NARRATED ONLY. No face, no figure, no body,
      // no silhouette that reads as a person, in any image, ever.
      prophets: "forbidden",
      otherSacredFigures: "symbolic",
      facesPermittedForSacredFigures: false,
      narrateOnly: Object.freeze([
        "Allah",
        "the prophets, including Muhammad, Ibrahim, Musa, Isa, Nuh and Yusuf",
        "angels",
      ]),
      visualSubstitutes: Object.freeze([
        "the landscape the events happened in — desert, sea, mountain, orchard, city wall",
        "light, dawn, lamplight, the shadow of an arch",
        "objects: a water jar, a rope, a wooden boat, a date palm, a lantern, an open book",
        "architecture: arches, courtyards, minarets and domes as part of a lived-in street",
        "geometric and floral pattern, calligraphic ornament without legible sacred text",
      ]),
      extensions: Object.freeze([
        {
          id: "prophets_family",
          label: "The Prophet's family (Ahl al-Bayt)",
          // Cautious reading, applied by default. See rationale.
          appliedByDefault: true,
          rationale:
            "Many families extend the prohibition on depicting the Prophet to his family. The cost of extending it wrongly is a plainer picture; the cost of not extending it is a picture a family cannot show their child. Default on.",
        },
        {
          id: "prophets_companions",
          label: "The Prophet's companions (Sahaba)",
          appliedByDefault: true,
          rationale:
            "The same extension is widely held for the companions, with more variation between communities. Default on for the same asymmetry.",
        },
      ]),
    },
    divineAddress: "Allah",
    scripturePolicy: scripture(["the Qur'an", "the hadith"]),
    narrationRules: Object.freeze([
      "No character in the story ever voices a prophet. A prophet gets no dialogue, no quoted speech, no inner monologue, and no line another character reports word for word.",
      "A prophet may be spoken ABOUT in narration — what they did, what happened, what it meant — and that is the only way they appear.",
      "Never quote the Qur'an and never quote a hadith, in Arabic or in translation, however short and however sure you are of it.",
      "Everyday religious speech in a family's mouth is welcome and ordinary: bismillah, alhamdulillah, inshallah, salaam. These are greetings and habits, not quotations.",
      "Prayer, fasting, the mosque and the adhan may appear as ordinary life, described plainly and without explanation to an outsider.",
      "Do not resolve the story by divine intervention. What changes should change through a character's choice.",
    ]),
    avoidStereotypes: Object.freeze([
      "reducing the tradition to a mosque, a hijab and a crescent moon",
      "the desert as the default setting — most Muslims live nowhere near one",
      "an Arab-only cast: the largest Muslim populations are South and Southeast Asian",
      "a hijab as a plot device, a thing to be removed, resented or explained",
      "any adjacency to violence, extremism or rescue-from-one's-own-family narratives",
      "a story whose subject is being Muslim rather than a story about a family who are",
    ]),
    notes:
      "The narrate-only rule is the founder's hard requirement and is encoded twice on purpose: as `prophets: forbidden` plus `narrateOnly` for the image layer, and as the first two `narrationRules` for the prompt layer. Both layers must honour it independently; neither may rely on the other having done it.",
    sourceNeeded: Object.freeze([
      "Confirm the default-on extensions with practitioners across Sunni and Shia communities; the family/companions readings differ between them.",
      "Confirm that the everyday-phrase allowance (bismillah, alhamdulillah) is read as speech and not as quotation.",
    ]),
  },

  // -------------------------------------------------------------------------
  jewish: {
    id: "jewish",
    label: "Jewish",
    promptName: "a Jewish family's tradition",
    supported: true,
    depiction: {
      // See DIVINE_DEPICTION_CONFLICT above before changing this line.
      divine: "forbidden",
      prophets: "symbolic",
      otherSacredFigures: "symbolic",
      facesPermittedForSacredFigures: false,
      narrateOnly: Object.freeze([
        "God",
        "the prophets, including Moses, Elijah and Isaiah",
      ]),
      visualSubstitutes: Object.freeze([
        "light: candles, a window at dusk, the first star of an evening",
        "the table — bread, a cup, a cloth, a set place",
        "the landscape and the street of the place the family lives in",
        "text as object rather than as legible words: a closed book, a scroll's covering",
      ]),
      extensions: Object.freeze([
        {
          id: "written_divine_name",
          label: "Writing the divine name in full",
          appliedByDefault: true,
          rationale:
            "Many observant families avoid writing the name out, since the page may later be discarded. Prefer the spoken address in `divineAddress`. Default on; the cost of applying it is a word changed.",
        },
      ]),
    },
    divineAddress: "Hashem",
    scripturePolicy: scripture(["the Torah", "the Tanakh", "the Talmud"]),
    narrationRules: Object.freeze([
      "Never quote the Torah or the Talmud, in Hebrew or in translation, and never cite a chapter and verse.",
      "Shabbat, candles, the blessing over bread and the rhythm of the week may appear as ordinary family life, described plainly and without explaining them to an outsider.",
      "Prefer the spoken address for the Divine over the written name.",
      "Never write a line of dialogue for God, and never narrate God's inner thoughts.",
      "Do not name a movement — Orthodox, Conservative, Reform — unless the brief does.",
      "Do not resolve the story by a miracle. What changes should change through a character's choice.",
    ]),
    avoidStereotypes: Object.freeze([
      "reducing the tradition to a menorah, a Star of David and a synagogue",
      "the Holocaust as the default subject of any Jewish story, and especially of a bedtime one",
      "money, business or accent jokes in any form",
      "an Ashkenazi-only cast: Sephardi, Mizrahi and Ethiopian families exist and are not exotic variants",
      "New York as the default setting",
    ]),
    notes:
      '`divineAddress: "Hashem"` is the customary spoken substitution in many observant families and is safe as a default; it is not universal, and a secular or Reform family in a story may simply say God.',
    sourceNeeded: Object.freeze([
      "Confirm with practitioners across Orthodox, Conservative, Reform and Sephardi/Mizrahi communities that `Hashem` is a safe default rather than a marked one.",
      "Confirm whether depicting named prophets should be `symbolic` (current) or `forbidden`.",
    ]),
  },

  // -------------------------------------------------------------------------
  hindu: {
    id: "hindu",
    label: "Hindu",
    promptName: "a Hindu family's tradition",
    supported: true,
    depiction: {
      // See DIVINE_DEPICTION_CONFLICT above before changing this line. THIS IS
      // THE ONE MOST LIKELY TO BE RELAXED FIRST: deity images are entirely
      // normal in Hindu devotional and children's art, and the conservative
      // default is arguably less faithful to the tradition than the permissive
      // one. It ships off anyway because an image model renders deities with
      // the wrong attributes, vahana and arm count — a devotional error, not a
      // rendering one — so relaxing it needs a reviewed iconography spec as
      // well as the founder's decision.
      divine: "forbidden",
      prophets: "symbolic",
      otherSacredFigures: "symbolic",
      facesPermittedForSacredFigures: false,
      narrateOnly: Object.freeze([
        "the deities, including Rama, Krishna, Ganesha, Hanuman, Shiva, Durga and Lakshmi",
      ]),
      visualSubstitutes: Object.freeze([
        "the shrine corner of a home: a lamp, marigolds, a bell, a folded cloth",
        "light — a diya, a doorway at dusk, a lit courtyard",
        "rangoli, textile and temple pattern as ornament rather than as subject",
        "the river, the banyan, the street, the festival crowd seen from a child's height",
      ]),
      extensions: Object.freeze([]),
    },
    divineAddress: null,
    scripturePolicy: scripture([
      "the Ramayana",
      "the Mahabharata",
      "the Bhagavad Gita",
      "the Puranas",
    ]),
    narrationRules: Object.freeze([
      "Never quote the Gita or any shloka, in Sanskrit or in translation, and never cite a chapter and verse.",
      "A deity may be spoken about in narration — what a family tells their child, what a festival remembers — without being given dialogue or an inner voice.",
      "Puja, a lamp at the shrine, a festival morning and touching an elder's feet may appear as ordinary family life, described plainly and without explanation to an outsider.",
      "Do not resolve the story by divine intervention. What changes should change through a character's choice.",
      "Do not treat the tradition as exotic. It is this family's ordinary Tuesday.",
      "Do not introduce caste as a subject, and never as a descriptor of a character.",
    ]),
    avoidStereotypes: Object.freeze([
      "reducing the tradition to a temple, a sari and an om symbol",
      "incense, chanting and mysticism as atmosphere",
      "the guru, the yogi and the snake charmer",
      "a saffron-and-gold colour wash over every image",
      "treating India as the only place Hindus live",
      "a story whose subject is being Hindu rather than a story about a family who are",
    ]),
    notes:
      '`divine: "forbidden"` here is the least natural fit of the four and is expected to be the first relaxed; see the comment on the field.',
    sourceNeeded: Object.freeze([
      "An iconography spec per deity — attributes, vahana, arm count, colour — before `divine` is relaxed.",
      "Confirm with practitioners whether `symbolic` for sacred figures reads as respectful or as evasive.",
    ]),
  },

  // -------------------------------------------------------------------------
  // Declared, not yet supported. These normalise to absent.
  // -------------------------------------------------------------------------
  buddhist: declared("buddhist", "Buddhist"),
  sikh: declared("sikh", "Sikh"),
  jain: declared("jain", "Jain"),
  shinto: declared("shinto", "Shinto"),
  daoist: declared("daoist", "Daoist"),
  bahai: declared("bahai", "Bahá'í"),
  zoroastrian: declared("zoroastrian", "Zoroastrian"),
  indigenous: declared("indigenous", "Indigenous"),
  african_traditional: declared(
    "african_traditional",
    "African traditional religion",
  ),
  secular: declared("secular", "Secular / no faith"),
} as const satisfies Record<TraditionId, Tradition>;

/** Every declared id, supported or not. */
export const TRADITION_IDS: readonly TraditionId[] = Object.freeze(
  Object.keys(TRADITIONS),
) as readonly TraditionId[];

/** The ids Phase 1 will actually write a story for. */
export const SUPPORTED_TRADITION_IDS: readonly SupportedTraditionId[] = Object
  .freeze(
    TRADITION_IDS.filter((id) => TRADITIONS[id].supported),
  ) as readonly SupportedTraditionId[];

// ---------------------------------------------------------------------------
// Guards and accessors
// ---------------------------------------------------------------------------

/** Is this a name we recognise at all — supported or merely declared. */
export function isTraditionId(value: unknown): value is TraditionId {
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(TRADITIONS, value);
}

/** May this value reach a prompt. The only question that gates behaviour. */
export function isSupportedTradition(
  value: unknown,
): value is SupportedTraditionId {
  return isTraditionId(value) && TRADITIONS[value].supported;
}

/**
 * Normalise, never reject.
 *
 * An unknown id, a declared-but-unsupported id, a number, a null and an object
 * all become `undefined`, which means "no preference" — and a story written
 * with no preference is byte-identical to every story written before this
 * contract existed. Refusing a paid generation over a soft preference would
 * cost the writer their story.
 */
export function normalizeTradition(
  value: unknown,
): SupportedTraditionId | undefined {
  return isSupportedTradition(value) ? value : undefined;
}

export function getTradition(id: SupportedTraditionId): Tradition {
  return TRADITIONS[id];
}

/** The server-owned phrase for prose. Never a client string. */
export function traditionPromptName(id: SupportedTraditionId): string {
  return getTradition(id).promptName;
}

/** Whether any image may render the Divine for this tradition. */
export function mayDepictDivine(id: SupportedTraditionId): boolean {
  return getTradition(id).depiction.divine === "allowed";
}

/** Whether any image may render a prophet or messenger as a figure. */
export function mayDepictProphets(id: SupportedTraditionId): boolean {
  return getTradition(id).depiction.prophets === "allowed";
}

/**
 * The narrate-only figure classes for a tradition, including every extension
 * applied by default.
 *
 * "Narrate only" is a single claim with two halves, and both are true of every
 * entry this returns: never rendered in an image, and never given a voice.
 */
export function narrateOnlyFigures(
  id: SupportedTraditionId,
): readonly string[] {
  const { narrateOnly, extensions } = getTradition(id).depiction;
  return Object.freeze([
    ...narrateOnly,
    ...extensions.filter((e) => e.appliedByDefault).map((e) => e.label),
  ]);
}

/**
 * Whether a character may be given dialogue attributed to this figure class.
 * Always `false` for anything narrate-only; there is no configuration that
 * makes it `true`.
 */
export function mayVoiceFigure(
  id: SupportedTraditionId,
  figure: string,
): boolean {
  const needle = figure.trim().toLocaleLowerCase();
  if (!needle) return true;
  return !narrateOnlyFigures(id).some((entry) =>
    entry.toLocaleLowerCase().includes(needle)
  );
}

// ---------------------------------------------------------------------------
// The two axes, side by side
// ---------------------------------------------------------------------------

/**
 * A reader's standing world preference: culture and faith, held separately.
 *
 * Both fields are optional and independent. Neither is ever derived from the
 * other. Every combination is legal, including the ones a naive mapping would
 * forbid — `IN`+`muslim`, `IN`+`christian`, `US`+`jewish`, `JP`+`shinto` once
 * Shinto is supported.
 *
 * Absent means absent for each axis on its own: a reader may set a country and
 * no faith, a faith and no country, both, or neither, and "neither" must
 * produce exactly the prompt the product produced before either existed.
 */
export type WorldPreference = {
  readonly country?: CountryCode;
  readonly tradition?: SupportedTraditionId;
};

// ---------------------------------------------------------------------------
// Notes for the prompt and image layers
// ---------------------------------------------------------------------------

/**
 * WHAT THE NEXT TWO AGENTS MUST HONOUR, stated here because this module is the
 * contract they read and cannot enforce these from inside it:
 *
 * 1. ABSENT IS ABSENT. `normalizeTradition` returning `undefined` must produce
 *    a byte-identical prompt to today's. No default tradition, no empty block,
 *    no extra newline.
 *
 * 2. THE BRIEF WINS. A tradition is a default for what the idea leaves open,
 *    exactly as `buildStoryWorldBlock` treats the country preference. It never
 *    overrides an explicit brief.
 *
 * 3. USER PROMPT ONLY. A tradition varies per story, so nothing derived from it
 *    may enter the SYSTEM prompt — it would break the cached prefix and make
 *    every generation more expensive. Build the block into the user prompt.
 *
 * 4. BOTH LAYERS ENFORCE NARRATE-ONLY INDEPENDENTLY. The image layer reads
 *    `depiction`; the prompt layer reads `narrationRules` and
 *    `narrateOnlyFigures`. Neither may assume the other did it.
 *
 * 5. NO SCRIPTURE QUOTATION, from either layer, in any tradition, in Phase 1.
 *    `UNIVERSAL_SCRIPTURE_RULES` is the wording to state it with.
 */
