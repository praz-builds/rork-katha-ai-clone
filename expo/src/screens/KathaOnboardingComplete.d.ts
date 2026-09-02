import type { ReactElement } from "react";
import type { KathaOnboardingResult } from "./KathaOnboardingFlowV2";

export type KathaOnboardingCompleteProps = {
  onDone?: (result: KathaOnboardingResult) => void;
  onSignIn?: () => void;
};

export default function KathaOnboardingComplete(
  props: KathaOnboardingCompleteProps,
): ReactElement;
