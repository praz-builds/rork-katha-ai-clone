/**
 * App feedback: the Profile "Send feedback" sheet posts here.
 *
 * NOT the `feedback` function. That one posts a COMMENT on a story and needs a
 * story id; its name predates comments having their own function. This one
 * files a message about the app itself into `app_feedback` (migration 00097).
 *
 * Any caller with a session may write: a named account or an anonymous
 * (pre-email) identity. Identity comes from the JWT and nowhere else -- the
 * body carries no user id. The per-user bound (5 an hour, 20 a day) and the
 * retry replay are SQL's, under a lock, in `submit_app_feedback`; this file
 * validates the shape, relays the verdict, and answers 429 when refused.
 *
 * `context` in any logged error carries identifiers and enums only, never the
 * message: it is free text somebody typed.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeadersFor, handleCors } from "../_shared/cors.ts";
import { parseRequestId, readJsonObject } from "../_shared/operations.ts";

/** The categories the sheet offers. Mirrors `app_feedback_category_check`. */
export const APP_FEEDBACK_CATEGORIES = [
  "bug",
  "idea",
  "story",
  "other",
] as const;
export type AppFeedbackCategory = typeof APP_FEEDBACK_CATEGORIES[number];

/** Mirrors `app_feedback_platform_check`. */
const PLATFORMS = new Set(["ios", "android", "web"]);

/** Mirrors `app_feedback_message_length`. */
export const MAX_MESSAGE_LENGTH = 2000;

/** Small: a message and four short labels. Anything bigger is not feedback. */
const MAX_BODY_BYTES = 16 * 1024;

export type AppFeedbackInput = {
  requestId: string;
  category: AppFeedbackCategory;
  message: string;
  appVersion: string | null;
  platform: string | null;
  screen: string | null;
};

/** A short optional label: trimmed, capped, or null. Never an error. */
function optionalLabel(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * Validates a request body. The message and request id are the only required
 * fields; the rest are context a broken or older client may omit, so a bad
 * one is dropped rather than refusing the feedback it came with.
 */
export function parseAppFeedback(
  body: Record<string, unknown>,
): { ok: true; value: AppFeedbackInput } | { ok: false; error: string } {
  const requestId = parseRequestId(body.request_id);
  if (!requestId) return { ok: false, error: "request_id is required" };

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return { ok: false, error: "message is required" };
  if (message.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer`,
    };
  }

  const category = APP_FEEDBACK_CATEGORIES.find((c) => c === body.category) ??
    "other";
  const platform = optionalLabel(body.platform, 16);

  return {
    ok: true,
    value: {
      requestId,
      category,
      message,
      appVersion: optionalLabel(body.app_version, 32),
      platform: platform && PLATFORMS.has(platform) ? platform : null,
      screen: optionalLabel(body.screen, 64),
    },
  };
}

export type SubmitVerdict =
  | { status: 200; body: { sent: true; replayed: boolean } }
  | { status: 429; body: { error: string; rate_limited: true } }
  | { status: 500; body: { error: string } };

/** Turns the RPC's jsonb into the HTTP answer. Anything unrecognised is a 500. */
export function verdictFrom(data: unknown): SubmitVerdict {
  let row: unknown = data;
  if (typeof row === "string") {
    try {
      row = JSON.parse(row);
    } catch {
      row = null;
    }
  }
  if (row && typeof row === "object") {
    const record = row as Record<string, unknown>;
    if (record.rate_limited === true) {
      return {
        status: 429,
        body: {
          error:
            "You have sent a lot of feedback recently. Try again in a little while.",
          rate_limited: true,
        },
      };
    }
    if (record.rate_limited === false && typeof record.id === "string") {
      return {
        status: 200,
        body: { sent: true, replayed: record.replayed === true },
      };
    }
  }
  return { status: 500, body: { error: "Internal server error" } };
}

type Deps = {
  userIdFor: (authHeader: string) => Promise<string | null>;
  submit: (
    userId: string,
    input: AppFeedbackInput,
  ) => Promise<{ data: unknown; error: unknown }>;
};

function jsonResponse(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}

/** The handler, with its two outside calls injected so it can be tested. */
export function createHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    const cors = handleCors(req);
    if (cors) return cors;
    const respond = (body: unknown, status = 200) =>
      jsonResponse(req, body, status);

    if (req.method !== "POST") {
      return respond({ error: "Method not allowed" }, 405);
    }

    try {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return respond({ error: "Unauthorized" }, 401);
      const userId = await deps.userIdFor(authHeader);
      if (!userId) return respond({ error: "Unauthorized" }, 401);

      const body = await readJsonObject(req, MAX_BODY_BYTES);
      if (!body) return respond({ error: "Invalid JSON request body" }, 400);
      const parsed = parseAppFeedback(body);
      if (!parsed.ok) return respond({ error: parsed.error }, 400);

      const { data, error } = await deps.submit(userId, parsed.value);
      if (error) throw error;
      const verdict = verdictFrom(data);
      return respond(verdict.body, verdict.status);
    } catch (error) {
      console.error("app-feedback error:", error);
      return respond({ error: "Internal server error" }, 500);
    }
  };
}

if (import.meta.main) {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceClient = createClient(
    url,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  serve(createHandler({
    userIdFor: async (authHeader) => {
      const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await client.auth.getUser();
      return user?.id ?? null;
    },
    submit: async (userId, input) =>
      await serviceClient.rpc("submit_app_feedback", {
        p_user_id: userId,
        p_request_id: input.requestId,
        p_category: input.category,
        p_message: input.message,
        p_app_version: input.appVersion,
        p_platform: input.platform,
        p_screen: input.screen,
      }),
  }));
}
