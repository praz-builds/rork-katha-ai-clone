import { act, renderHook } from "@testing-library/react-native";

import { memberPlanId, memberPlanSummary, useStoreProfile } from "@/lib/member-plan";

const profile = (entitlement: Record<string, unknown> | undefined) => ({
  entitlements: { active: entitlement ? { katha: entitlement as never } : {} },
});

describe("what a member is told about their plan", () => {
  it("names the plan from the store product, Android base plan suffix and all", () => {
    expect(memberPlanId("ai.katha.sub.yearly:yearly")).toBe("yearly");
    expect(memberPlanId("ai.katha.sub.weekly")).toBe("weekly");
    expect(memberPlanId("something.else")).toBeNull();
    expect(memberPlanId(undefined)).toBeNull();
  });

  it("tells a weekly member their weekly grant, not the yearly one", () => {
    const summary = memberPlanSummary(
      profile({
        productIdentifier: "ai.katha.sub.weekly:weekly",
        periodType: "NORMAL",
        expirationDate: "2026-10-11T10:00:00Z",
        willRenew: true,
      }),
      "en-US",
    );
    expect(summary.planLabel).toBe("Weekly plan");
    expect(summary.facts[0]).toBe("20 credits a week");
    expect(summary.status).toBe("Renews on Oct 11, 2026.");
  });

  it("tells a trial member it is a trial, and when it turns into a plan", () => {
    const summary = memberPlanSummary(
      profile({
        productIdentifier: "ai.katha.sub.yearly:yearly",
        periodType: "TRIAL",
        expirationDate: "2026-10-07T10:00:00Z",
        willRenew: true,
      }),
      "en-US",
    );
    expect(summary.trial).toBe(true);
    expect(summary.planLabel).toBe("Yearly plan");
    expect(summary.facts[0]).toBe("10 credits during your trial");
    expect(summary.status).toBe(
      "Free trial until Oct 7, 2026. Your plan starts then, with its full credits, unless you cancel.",
    );
  });

  it("says a cancelled trial or plan ends, rather than renews", () => {
    expect(
      memberPlanSummary(
        profile({
          productIdentifier: "ai.katha.sub.yearly",
          periodType: "TRIAL",
          expirationDate: "2026-10-07T10:00:00Z",
          willRenew: false,
        }),
        "en-US",
      ).status,
    ).toBe("Free trial until Oct 7, 2026. It won't continue after that.");
    expect(
      memberPlanSummary(
        profile({
          productIdentifier: "ai.katha.sub.yearly",
          periodType: "NORMAL",
          expirationDate: "2027-10-03T10:00:00Z",
          willRenew: false,
        }),
        "en-US",
      ).status,
    ).toBe("Ends on Oct 3, 2027. It won't renew.");
  });

  it("falls back to the general summary with no store record (tester override, web)", () => {
    const summary = memberPlanSummary(profile(undefined));
    expect(summary.planLabel).toBeNull();
    expect(summary.status).toBe("Your plan is active. Here is what it includes.");
    // No store record, so no grant to state: only what every plan shares.
    expect(summary.facts).toHaveLength(3);
    expect(memberPlanSummary(null).planLabel).toBeNull();
  });
});

it("never guesses a grant for a product it does not recognise", () => {
  const summary = memberPlanSummary({
    entitlements: { active: { katha: { productIdentifier: "ai.katha.reader.yearly" } } },
  });
  expect(summary.planLabel).toBeNull();
  expect(summary.facts).toEqual([
    "Unlimited portraits and reimagines",
    "Premium voices",
    "Download as PDF",
  ]);
});

it("re-reads the store record when RevenueCat pushes an update", async () => {
  let push: (profile: unknown) => void = () => undefined;
  const service = {
    profile: { renews: true },
    subscribe: (listener: (profile: unknown) => void) => {
      push = listener;
      return () => undefined;
    },
  };
  const { result } = await renderHook(() => useStoreProfile(service));
  expect(result.current).toEqual({ renews: true });
  await act(async () => push({ renews: false }));
  expect(result.current).toEqual({ renews: false });
});

it("reads the legacy Test Store entitlement too", () => {
  const summary = memberPlanSummary({
    entitlements: {
      active: {
        katha_ai_pro: {
          productIdentifier: "ai.katha.sub.weekly",
          periodType: "NORMAL",
          expirationDate: "2026-10-11T10:00:00Z",
          willRenew: true,
        },
      },
    },
  }, "en-US");
  expect(summary.planLabel).toBe("Weekly plan");
  expect(summary.status).toBe("Renews on Oct 11, 2026.");
});
