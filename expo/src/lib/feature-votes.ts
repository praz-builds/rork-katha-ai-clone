import { isSupabaseConfigured, supabase } from "@/lib/supabase";

/**
 * Vote on what gets built next (migration 00099).
 *
 * Straight to PostgREST under RLS -- there is no edge function, because
 * nothing here is trusted: no credit moves, and a vote is one row per reader
 * per topic that the primary key already makes unique. The client may write
 * only `topic_id`; `user_id` is the server's.
 *
 * Topics are curated by the team. A reader cannot post one; an idea that is
 * not on the list goes through Send feedback (`lib/app-feedback.ts`, #140).
 */

export type FeedbackTopic = {
  id: string;
  title: string;
  detail: string | null;
  status: "open" | "planned" | "shipped";
  votes: number;
  voted: boolean;
};

/** Topics with their counts, most-voted first. `null` when they could not load. */
export async function loadFeedbackTopics(): Promise<FeedbackTopic[] | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const [topics, tallies] = await Promise.all([
      supabase
        .from("feedback_topics")
        .select("id, title, detail, status, sort_order")
        .order("sort_order", { ascending: true }),
      supabase.rpc("feedback_topic_tallies"),
    ]);
    // Both or neither: topics with the counts missing would show every vote
    // as 0 and "not voted", and a reader who had voted would vote again.
    if (topics.error || !Array.isArray(topics.data)) return null;
    if (tallies.error || !Array.isArray(tallies.data)) return null;
    const counts = new Map<string, { votes: number; voted: boolean }>();
    for (const row of tallies.data as Record<string, unknown>[]) {
      if (typeof row.topic_id !== "string") continue;
      counts.set(row.topic_id, {
        votes: Number(row.votes) || 0,
        voted: row.voted === true,
      });
    }
    return (topics.data as Record<string, unknown>[])
      .filter((row) => typeof row.id === "string" && typeof row.title === "string")
      .map((row): FeedbackTopic => ({
        id: row.id as string,
        title: row.title as string,
        detail: typeof row.detail === "string" ? row.detail : null,
        status: row.status === "planned"
          ? "planned"
          : row.status === "shipped"
          ? "shipped"
          : "open",
        votes: counts.get(row.id as string)?.votes ?? 0,
        voted: counts.get(row.id as string)?.voted ?? false,
      }))
      // Shipped work is shown last and cannot be voted on; the rest by votes,
      // with the team's order breaking ties so a fresh list is not shuffled.
      .sort((a, b) => {
        if ((a.status === "shipped") !== (b.status === "shipped")) {
          return a.status === "shipped" ? 1 : -1;
        }
        return b.votes - a.votes;
      });
  } catch {
    return null;
  }
}

/**
 * Adds or removes the caller's vote.
 *
 * `stale` means the server already had the vote the caller asked to add: the
 * list on screen was out of date, so an optimistic +1 on top of it would count
 * this reader twice. The caller reloads rather than trusting its own arithmetic.
 */
export type VoteResult = "ok" | "stale" | "failed";

export async function setFeedbackVote(topicId: string, on: boolean): Promise<VoteResult> {
  if (!isSupabaseConfigured) return "failed";
  try {
    if (on) {
      const { error } = await supabase.from("feedback_votes").insert({ topic_id: topicId });
      if (!error) return "ok";
      return error.code === "23505" ? "stale" : "failed";
    }
    const { error } = await supabase.from("feedback_votes").delete().eq("topic_id", topicId);
    return error ? "failed" : "ok";
  } catch {
    return "failed";
  }
}
