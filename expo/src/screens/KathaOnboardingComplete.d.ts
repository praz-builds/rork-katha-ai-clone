import type { ReactElement } from "react";
import type { KathaOnboardingResult } from "./KathaOnboardingFlowV2";

export type KathaOnboardingCompleteProps = {
  onDone?: (result: KathaOnboardingResult) => void;
  onSignIn?: () => void;
  /** Called instead of advancing when the user selects the writer purpose. */
  onWriterPath?: () => void;
};

export default function KathaOnboardingComplete(
  props: KathaOnboardingCompleteProps,
): ReactElement;
