import type { Genre } from "../types/domain";

export type OnboardingPurpose = "read" | "write" | "both";
export type OnboardingPlan = "weekly" | "yearly";
export type KathaOnboardingScreen =
  | "name"
  | "genres"
  | "purpose"
  | "email"
  | "notify"
  | "refine"
  | "moment"
  | "building"
  | "paywall"
  | "oto"
  | "success";

export type KathaOnboardingResult = {
  name: string;
  genres: string[];
  otherGenre: string;
  purpose: OnboardingPurpose | "";
  email: string;
  notificationsAllowed: boolean;
  refine: string;
  moment: string;
  plan: OnboardingPlan;
  trial: boolean;
};

export type KathaWriterPathPayload = {
  initialGenre?: Genre;
  onboarding: {
    name: string;
    genres: string[];
    otherGenre: string;
    purpose: OnboardingPurpose | "";
    refine: string;
    moment: string;
  };
};

export type KathaOnboardingFlowV2Props = {
  initialScreen?: KathaOnboardingScreen;
  onDone?: (result: KathaOnboardingResult) => void;
  /** Called after the writer setup questions, before the dedicated writer flow. */
  onWriterPath?: (payload: KathaWriterPathPayload) => void;
};

export default function KathaOnboardingFlowV2(
  props: KathaOnboardingFlowV2Props
): import("react").ReactElement;
