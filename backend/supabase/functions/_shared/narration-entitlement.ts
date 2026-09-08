/**
 * Narration generation entitlement gate.
 *
 * This is the single place where "may this request start fresh paid narration"
 * is decided. The credits session should replace the current flag-only answer
 * with the durable one-credit unlock check and any permanent entitlement rules.
 * Pricing, grants, ledger reads/writes, and unlock decisions do not belong in
 * `generate-audio`, `audio-status`, preview seeding, or any future caller.
 *
 * The default is intentionally today's production behavior: fresh narration is
 * closed unless `NARRATION_GENERATION_ENABLED` is explicitly enabled.
 *
 * ## Why "narration was never generated for a story" has no alert
 *
 * The product owner's first request was to be alerted when a *created* story
 * never gets narration. That cannot be built honestly on top of this gate.
 * Generation is lazy -- it only ever runs when a reader presses Listen -- and
 * gated closed by default here, so on any given day almost every story in the
 * library correctly has zero narration: nobody asked for it, or the gate was
 * closed when they did. An alert on "no `chapter_audio` row exists" would
 * fire for effectively every story ever published, which is precisely the
 * "fires constantly for stories nobody pressed Listen on" failure mode this
 * system must not invent.
 *
 * The only failures that are honestly observable today are the two this
 * module's callers alert on: a generation attempt that failed
 * (`generate-audio` asking RunPod and getting back a failure), and a
 * generation attempt that never reached a terminal state
 * (`audio-status`'s stale-`pending` check, see `NARRATION_JOB_STALE_MS` in
 * `narration-audio.ts`). Both require a reader to have actually tried.
 * "Nobody has tried yet" is not distinguishable from "narration silently
 * failed to generate" while generation stays demand-driven -- there is no
 * signal to alert on.
 *
 * That changes if generation ever moves from lazy to eager (the "Inngest
 * integration for auto-generation on publish" noted as planned-but-not-wired
 * in `AGENTS.md`'s Audio Narration System section). Once every published
 * story is *supposed* to have narration shortly after publish, "a story
 * published more than N minutes ago with no ready `chapter_audio` row and no
 * matching failure" becomes a real, non-constant absence signal. Until then,
 * building that alert against the lazy, closed-by-default path in this file
 * would either be silent (the gate is closed, so it never fires) or wrong (a
 * false "generation is broken" for stories no one has listened to).
 */

export interface NarrationEntitlementContext {
  userId?: string | null;
  storyId?: string | null;
  chapterId?: string | null;
  voiceId?: string | null;
  purpose?: "chapter" | "preview";
  env?: Pick<typeof Deno.env, "get">;
}

export interface NarrationEntitlement {
  allowed: boolean;
  reason: string;
}

export function canGenerateNarration(
  ctx: NarrationEntitlementContext = {},
): NarrationEntitlement {
  const env = ctx.env ?? Deno.env;
  const enabled = (env.get("NARRATION_GENERATION_ENABLED") ?? "")
    .trim()
    .toLowerCase();

  if (["1", "true", "yes", "on", "enabled"].includes(enabled)) {
    return { allowed: true, reason: "enabled_by_env" };
  }

  return {
    allowed: false,
    reason: "narration_generation_disabled",
  };
}
