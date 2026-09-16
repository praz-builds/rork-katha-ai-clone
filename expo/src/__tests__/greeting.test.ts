/**
 * The Home greeting is pure: a Date in, a phrase out. These pin the daypart
 * boundaries (D4), the per-day stability, and the one line the night must
 * never say.
 */
import {
  dayOfYear,
  daypart,
  GREETING_PHRASES,
  greetingLine,
} from "@/lib/greeting";

const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 0, day, hour, minute, 0, 0);

describe("daypart", () => {
  it("splits the clock at 5, 12, 17 and 21", () => {
    expect(daypart(5)).toBe("morning");
    expect(daypart(11)).toBe("morning");
    expect(daypart(12)).toBe("afternoon");
    expect(daypart(16)).toBe("afternoon");
    expect(daypart(17)).toBe("evening");
    expect(daypart(20)).toBe("evening");
    expect(daypart(21)).toBe("night");
    expect(daypart(23)).toBe("night");
    expect(daypart(0)).toBe("night");
    expect(daypart(4)).toBe("night");
  });

  it("tolerates a hour outside 0-23 rather than throwing", () => {
    expect(daypart(24)).toBe("night");
    expect(daypart(-1)).toBe("night");
    expect(daypart(Number.NaN)).toBe("night");
  });
});

describe("the phrase lists", () => {
  it("offer at least three lines per daypart", () => {
    for (const lines of Object.values(GREETING_PHRASES)) {
      expect(lines.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("never wish the reader good night", () => {
    for (const line of GREETING_PHRASES.night) {
      expect(line.toLowerCase()).not.toContain("good night");
      expect(line.toLowerCase()).not.toContain("goodnight");
    }
  });

  it("carry no name placeholder -- the name is Home's second line", () => {
    for (const lines of Object.values(GREETING_PHRASES)) {
      for (const line of lines) {
        expect(line).not.toMatch(/\{|\}|%s/);
        // A line that ends in a comma or "hi <name>" is one that was written
        // expecting a name to be glued on. No comma at all, anywhere: an
        // interior one means the line addresses the reader ("Morning,
        // storyteller"), and Home already addresses them by name on the line
        // directly below, so the screen would greet the same person twice.
        expect(line).not.toContain(",");
        expect(line.toLowerCase()).not.toMatch(/\bname\b/);
      }
    }
  });
});

describe("greetingLine", () => {
  it("picks from the daypart's own list", () => {
    expect(GREETING_PHRASES.morning).toContain(greetingLine(at(10, 8)));
    expect(GREETING_PHRASES.afternoon).toContain(greetingLine(at(10, 14)));
    expect(GREETING_PHRASES.evening).toContain(greetingLine(at(10, 19)));
    expect(GREETING_PHRASES.night).toContain(greetingLine(at(10, 23)));
    expect(GREETING_PHRASES.night).toContain(greetingLine(at(10, 2)));
  });

  it("is stable across the whole daypart on one day", () => {
    expect(greetingLine(at(40, 5))).toBe(greetingLine(at(40, 11, 59)));
    expect(greetingLine(at(40, 21))).toBe(greetingLine(at(40, 23, 59)));
  });

  it("changes with the day of the year, so a daily reader sees variety", () => {
    const seen = new Set<string>();
    for (let day = 1; day <= 8; day += 1) {
      seen.add(greetingLine(at(day, 9)));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("cycles through every line of a daypart over consecutive days", () => {
    const seen = new Set<string>();
    for (let day = 1; day <= 60; day += 1) seen.add(greetingLine(at(day, 22)));
    expect([...seen].sort()).toEqual([...GREETING_PHRASES.night].sort());
  });
});

describe("dayOfYear", () => {
  it("counts from 1 on New Year's Day", () => {
    expect(dayOfYear(new Date(2026, 0, 1, 15))).toBe(1);
    expect(dayOfYear(new Date(2026, 1, 1, 0, 30))).toBe(32);
    expect(dayOfYear(new Date(2026, 11, 31, 23, 59))).toBe(365);
  });

  it("does not drift across a DST change", () => {
    expect(dayOfYear(new Date(2026, 6, 1, 12))).toBe(182);
  });
});
