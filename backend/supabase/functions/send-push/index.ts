import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { notifyUser } from "../_shared/notify.ts";

type SendKind = "story_ready" | "chapter_ready" | "draft_waiting";

/**
 * Service-role only. It sends to a user's devices on their behalf, so it must
 * never be reachable with a user's own JWT: a caller who could name the
 * recipient could push arbitrary copy to anyone in the project.
 */
serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const respond = (body: unknown, status = 200) =>
    jsonResponse(req, body, status);

  if (req.method !== "POST") {
    return respond({ error: "Method not allowed" }, 405);
  }

  try {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const provided = req.headers.get("Authorization")?.replace(
      /^Bearer\s+/i,
      "",
    );
    // Constant time. `!==` on a secret returns as soon as two bytes differ, and
    // this endpoint is reachable by anyone who can guess a URL, so the timing
    // difference is a usable oracle for recovering the key one byte at a time.
    if (!provided || !(await timingSafeEqualAsync(provided, serviceRoleKey))) {
      return respond({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => null) as {
      user_id?: unknown;
      kind?: unknown;
      story_id?: unknown;
      title?: unknown;
      chapter_number?: unknown;
    } | null;
    if (!body || typeof body.user_id !== "string") {
      return respond({ error: "user_id is required" }, 400);
    }
    const kind = body.kind;
    if (
      kind !== "story_ready" && kind !== "chapter_ready" &&
      kind !== "draft_waiting"
    ) {
      return respond({ error: "Unsupported notification kind" }, 400);
    }
    const title = typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : "Your story";
    const chapterNumber = typeof body.chapter_number === "number"
      ? body.chapter_number
      : 1;

    // The body of this function lives in `_shared/notify.ts` so a generation
    // path can fire the same notification in process instead of making an HTTP
    // call back into this one. This endpoint stays for schedulers and for the
    // draft-waiting sweep, which have no isolate of their own to run in.
    const result = await notifyUser({
      userId: body.user_id,
      kind: kind as SendKind,
      storyId: typeof body.story_id === "string" ? body.story_id : null,
      title,
      chapterNumber,
    });
    if (result.reason === "no_tokens") {
      return respond({ sent: 0, reason: "no_tokens" });
    }
    return respond({ sent: result.sent, pruned: result.pruned });
  } catch (error) {
    console.error("send-push error:", error);
    return respond({ error: "Unable to send notification" }, 500);
  }
});

/**
 * Compare two secrets without leaking their length or their first difference.
 *
 * Hashing first is what makes the length safe: a raw byte-wise loop over
 * strings of different lengths has to stop somewhere, and where it stops is the
 * leak. Two SHA-256 digests are always 32 bytes.
 */
async function timingSafeEqualAsync(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}


function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}
