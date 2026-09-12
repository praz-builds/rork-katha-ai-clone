import type { ReactElement } from "react";
import type { KathaCharacterPathPayload } from "./KathaOnboardingFlowV2";

export type KathaOnboardingCompleteProps = {
  onSignIn?: () => void;
  /** The one exit from the questionnaire. Read, write and both all use it. */
  onCharacterPath?: (payload: KathaCharacterPathPayload) => void;
};

export default function KathaOnboardingComplete(
  props: KathaOnboardingCompleteProps,
): ReactElement;
