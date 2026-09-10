/**
 * The reader's reading streak, read from the row that actually records it.
 *
 * THE NUMBER IS REAL OR IT IS ABSENT. There is no default, no "1 to get them
 * started", and no client-side count of app opens. `streaks` (migration
 * 00001) is written by exactly one thing — `touch_streak`, called from
 * `_shared/engagement.ts` when a read is recorded — and `current_streak` is
 * what that produced. A streak glyph is a claim about the person looking at
 * it; a fabricated one is a lie the app tells its own reader every morning,
 * and it is worse than showing nothing, because the reader has no way to
 * tell it from the true one.
 *
 * So this returns `null` for every case that is not "the database says N":
 * Supabase not configured, no session, no row yet, a network failure, a zero
 * streak. The header renders the item only for a number.
 *
 * The read is allowed without an edge function: `00002` grants
 * `select using (auth.uid() = user_id)` on `streaks` and `00012` grants
 * `SELECT` to `authenticated`, so a reader can see their own row and no one
 * else's. Nothing here can write one — `touch_streak` is `revoke all from
 * public` / `grant execute to service_role`, which is correct: a streak the
 * client could increment is not a streak.
 */
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export type ReadingStreak = {
  /** Consecutive days with a recorded read. Always >= 1 when present. */
  current: number;
  /** The best run so far, for a profile screen that wants it. */
  longest: number;
};

/**
 * The caller's streak, or `null` when there is no true value to show.
 *
 * Never throws and never logs an error the reader would see. This runs on
 * boot beside the credit balance, and a missing streak must degrade to an
 * absent glyph, not to a broken header.
 */
export async function fetchReadingStreak(): Promise<ReadingStreak | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return null;

    const { data, error } = await supabase
      .from("streaks")
      .select("current_streak, longest_streak")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data) return null;

    const record = data as Record<string, unknown>;
    const current = typeof record.current_streak === "number"
      ? record.current_streak
      : 0;
    // A zero streak is a row that exists and says "not today". That is not a
    // streak, and a flame reading "0" is noise in a header that has three
    // things in it.
    if (!Number.isFinite(current) || current < 1) return null;

    const longest = typeof record.longest_streak === "number"
      ? record.longest_streak
      : current;

    return { current: Math.floor(current), longest: Math.floor(longest) };
  } catch {
    return null;
  }
}
