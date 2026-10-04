import { memberPlanId, memberPlanSummary } from "@/lib/member-plan";

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
    expect(summary.facts).toHaveLength(4);
    expect(memberPlanSummary(null).planLabel).toBeNull();
  });
});
