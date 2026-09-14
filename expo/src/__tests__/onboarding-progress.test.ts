/**
 * The one table both onboarding screens read their pills from.
 *
 * The rule under test: one pill per step, every question a step, W3 a step,
 * the four character screens one step, and the count told honestly per
 * purpose. A regression here shows up on screen as a row that stalls or
 * skips, which no render test would catch.
 */
import {
  onboardingProgress,
  questionStep,
  STEPS_BEFORE_PURPOSE,
} from "@/lib/onboarding-progress";

describe("onboardingProgress", () => {
  it("counts a reader's eight and a writer's seven", () => {
    expect(onboardingProgress("read")).toEqual({
      total: 8,
      question: { name: 1, genres: 2, purpose: 3, refine: 4, mood: 5, moment: 6 },
      w3: 7,
      character: 8,
    });
    expect(onboardingProgress("write")).toEqual({
      total: 7,
      question: { name: 1, genres: 2, purpose: 3, refine: 4, moment: 5 },
      w3: 6,
      character: 7,
    });
    expect(onboardingProgress("both")).toEqual(onboardingProgress("write"));
  });

  it("ends every path on its last pill, with the character as the last step", () => {
    for (const purpose of ["read", "write", "both"] as const) {
      const progress = onboardingProgress(purpose);
      expect(progress.character).toBe(progress.total);
      expect(progress.w3).toBe(progress.total - 1);
      // Every question pill is below W3, and none repeats.
      const pills = Object.values(progress.question);
      expect(new Set(pills).size).toBe(pills.length);
      expect(Math.max(...pills)).toBe(progress.w3 - 1);
    }
  });

  it("draws the longest row before the purpose is known, so it can only shorten", () => {
    expect(STEPS_BEFORE_PURPOSE).toBe(8);
    expect(questionStep("name", "")).toEqual({ steps: 8, currentStep: 1 });
    expect(questionStep("purpose", "")).toEqual({ steps: 8, currentStep: 3 });
    expect(questionStep("refine", "write")).toEqual({ steps: 7, currentStep: 4 });
    expect(questionStep("moment", "read")).toEqual({ steps: 8, currentStep: 6 });
  });
});
