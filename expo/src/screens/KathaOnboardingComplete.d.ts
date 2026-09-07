import type { ReactElement } from "react";
import type {
  KathaOnboardingResult,
  KathaWriterPathPayload,
} from "./KathaOnboardingFlowV2";

export type KathaOnboardingCompleteProps = {
  onDone?: (result: KathaOnboardingResult) => void;
  onSignIn?: () => void;
  /** Called after the writer setup questions, before the dedicated writer flow. */
  onWriterPath?: (payload: KathaWriterPathPayload) => void;
};

export default function KathaOnboardingComplete(
  props: KathaOnboardingCompleteProps,
): ReactElement;
