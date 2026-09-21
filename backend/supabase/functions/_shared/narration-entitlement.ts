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
  /**
   * What the narration is FOR, which is now a gate and not a label.
   *
   * - `chapter` -- a reader pressed Listen. Governed by
   *   `NARRATION_GENERATION_ENABLED`, as it always has been.
   * - `preview` -- voice-picker sample seeding.
   * - `prefetch` -- nobody has pressed anything; the client is synthesising a
   *   chapter ahead of time so it starts instantly if they do. See
   *   `NARRATION_PREFETCH_ENABLED`.
   */
  purpose?: "chapter" | "preview" | "prefetch";
  env?: Pick<typeof Deno.env, "get">;
}

/** The documented truthy spellings, shared by both flags. */
function flagIsOn(
  env: Pick<typeof Deno.env, "get">,
  name: string,
): boolean {
  const value = (env.get(name) ?? "").trim().toLowerCase();
  return ["1", "true", "yes", "on", "enabled"].includes(value);
}

export interface NarrationEntitlement {
  allowed: boolean;
  reason: string;
}

export function canGenerateNarration(
  ctx: NarrationEntitlementContext = {},
): NarrationEntitlement {
  const env = ctx.env ?? Deno.env;

  // Prefetch is refused FIRST, and refused by default.
  //
  // A prefetch is paid synthesis nobody asked for: the client decides, on its
  // own, to narrate a chapter in case the reader wants it. If that decision is
  // ever wrong -- a loop, a screen that mounts twice, a list that prefetches
  // every card -- the cost is real provider spend against a reader who never
  // pressed Listen, and the only way to stop it would be a client release.
  // Behind its own flag it ships dark: the feature can be built, deployed and
  // exercised by a client that asks for it, and turning it on (or off again,
  // mid-incident) is an env change with no deploy and no app store.
  //
  // Checked before `NARRATION_GENERATION_ENABLED` on purpose, so opening
  // narration to readers never silently opens prefetch too.
  if (
    ctx.purpose === "prefetch" && !flagIsOn(env, "NARRATION_PREFETCH_ENABLED")
  ) {
    return { allowed: false, reason: "narration_prefetch_disabled" };
  }

  if (flagIsOn(env, "NARRATION_GENERATION_ENABLED")) {
    return { allowed: true, reason: "enabled_by_env" };
  }

  return {
    allowed: false,
    reason: "narration_generation_disabled",
  };
}
