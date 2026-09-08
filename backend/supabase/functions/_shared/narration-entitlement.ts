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
