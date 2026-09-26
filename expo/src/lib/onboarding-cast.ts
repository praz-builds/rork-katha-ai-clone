import stageAthletic from "../../assets/onboarding/stage-athletic.webp";
import stageChild from "../../assets/onboarding/stage-child.webp";
import stageHeavyset from "../../assets/onboarding/stage-heavyset.webp";

/**
 * The three people on W3's stage, and the face on the questionnaire's Up next
 * card. One table, so the card and the stage cannot drift apart.
 *
 * THREE DIFFERENT PEOPLE, THREE DIFFERENT BODIES (2026-09-25). The stage used
 * to hold one hero and the same side portrait twice, so the "anyone can be the
 * lead" pitch was made by two copies of one slim adult. These are a heavyset
 * woman in her forties, an athletic man in his thirties and a nine-year-old
 * girl: age, build and background all vary, which is the promise W3 makes.
 *
 * The images are cut to the card's own 5:7 (450 x 630, three times the
 * 150 x 210 card) on a flat `onboardingStone`-coloured ground with no border
 * and no rounded corners of their own. The old PNGs carried a baked-in frame
 * and a different aspect, so `cover` cropped them and the frame showed as a
 * second edge inside the card. Head to feet sits inside the middle 80%, so
 * nothing is lost if a card is ever drawn at another ratio.
 *
 * Order is the stage's: `[0]` is the hero, `[1]` the left card, `[2]` the right.
 */
export const STAGE_CAST: readonly {
  key: string;
  source: number;
  label: string;
}[] = [
  {
    key: "heavyset",
    source: stageHeavyset,
    label: "A woman in a mustard kurta with a tote bag",
  },
  {
    key: "athletic",
    source: stageAthletic,
    label: "A man in a rust track jacket",
  },
  {
    key: "child",
    source: stageChild,
    label: "A girl in a green raincoat holding a book",
  },
];
