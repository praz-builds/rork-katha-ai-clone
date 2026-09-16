/**
 * The Home greeting: a phrase for the time of day, chosen once per day.
 *
 * Pure on purpose. The screen hands in a `Date` and gets a string back, so the
 * whole thing is testable at every hour and on every day of the year without
 * a clock to mock. Nothing here reads the clock itself.
 *
 * WHY A PHRASE PER DAY AND NOT PER RENDER. Home re-renders on every feed
 * fetch, every credit change and every tab switch. A greeting picked at
 * random on each render changes under the reader while they are looking at
 * it, which reads as a glitch rather than as variety. Day-of-year is the
 * seed, so the line is the same for the whole day and different tomorrow.
 *
 * THE NIGHT NEVER SAYS "GOOD NIGHT". Somebody opening the app at 23:40 is
 * about to read, not about to sleep; wishing them good night is telling them
 * to leave. The night lines lean the other way and invite one more chapter.
 */

export type Daypart = "morning" | "afternoon" | "evening" | "night";

/**
 * Which part of the day an hour (0-23, device clock) belongs to.
 *
 * Morning 5-11, afternoon 12-16, evening 17-20, night 21-4. The boundaries
 * are the product decision, not an astronomical one: 16:30 is "afternoon"
 * because nobody has finished work yet, and 21:00 is already "night" because
 * the reader with the app open then is winding down, not starting out.
 */
export function daypart(hour: number): Daypart {
  const h = Number.isFinite(hour) ? ((Math.floor(hour) % 24) + 24) % 24 : 0;
  if (h >= 5 && h <= 11) return "morning";
  if (h >= 12 && h <= 16) return "afternoon";
  if (h >= 17 && h <= 20) return "evening";
  return "night";
}

/**
 * The lines, by daypart. At least three each so a daily reader does not see
 * the same line every morning of the week.
 *
 * Kept SHORT. The greeting shares its row with the streak, credits and bell
 * pills, and on a 390pt screen that leaves roughly 200pt for the words. Every
 * line here fits that in the UI face at 15pt without wrapping; a new line
 * that does not is a new line that wraps under the pills.
 */
export const GREETING_PHRASES: Readonly<Record<Daypart, readonly string[]>> = {
  morning: [
    "Good morning",
    "Rise and shine",
    "A fresh page awaits",
    "Early pages",
  ],
  afternoon: [
    "Good afternoon",
    "A story for later?",
    "Afternoon reading time",
    "Halfway through the day",
  ],
  evening: [
    "Good evening",
    "Settle in for a story",
    "The evening is yours",
    "Time to unwind",
  ],
  night: [
    "Still awake?",
    "Late-night tales",
    "One more chapter?",
    "The night is quiet",
  ],
};

/** Day of the year, 1-366, in the date's local time zone. */
export function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 1);
  const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((midnight.getTime() - start.getTime()) / 86_400_000) + 1;
}

/**
 * The phrase for this moment: the daypart from the hour, the line from the
 * day of the year. Stable for the whole day within a daypart, and it never
 * contains the reader's name -- Home renders the name on its own line.
 */
export function greetingLine(date: Date = new Date()): string {
  const phrases = GREETING_PHRASES[daypart(date.getHours())];
  return phrases[dayOfYear(date) % phrases.length] ?? phrases[0];
}
