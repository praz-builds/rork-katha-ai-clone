/**
 * Shared plumbing for the Originals scripts: env, the service client, and a
 * signed-in session for the house account.
 *
 * The house account is a real, non-anonymous user because publishing is
 * refused to anonymous guests (`applyRequestedVisibility`). Its session is
 * minted with the admin magic-link flow, so it has no password to leak.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const HOUSE_EMAIL = "originals@kathaai.test";

export function loadEnv(): Record<string, string> {
  const text = Deno.readTextFileSync("/Users/mac16/Katha AI/backend/.env");
  return Object.fromEntries(
    text.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
  );
}

export const env = loadEnv();
export const service: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/** A client signed in as the house account, refreshing its own token. */
export async function houseClient(): Promise<{ client: SupabaseClient; userId: string }> {
  const { data: link, error } = await service.auth.admin.generateLink({
    type: "magiclink",
    email: HOUSE_EMAIL,
  });
  if (error) throw error;
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: true },
  });
  const { data, error: otpError } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (otpError || !data.session) throw otpError ?? new Error("no session");
  return { client, userId: data.session.user.id };
}

/** POST a function as the given client's user; returns status and JSON. */
export async function callFunction(
  client: SupabaseClient,
  name: string,
  body: unknown,
  timeoutMs = 280_000,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error("house session lost");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text.slice(0, 400) };
    }
    return { status: res.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST a streamed generation (`generate-story-stream`, or `continue-story`
 * with `stream: true`) the way the app does, and wait for its terminal event.
 *
 * Streaming is not a nicety here: a buffered call must finish the whole model
 * chain inside the gateway's 150s idle timeout (a 125s budget), while a stream
 * keeps the connection alive and gets a 180s deadline. The app streams, so this
 * is the path real readers' stories take.
 */
export async function callStream(
  client: SupabaseClient,
  name: string,
  body: unknown,
  timeoutMs = 330_000,
): Promise<{ status: number; event: string; body: Record<string, unknown> }> {
  const { data: { session } } = await client.auth.getSession();
  if (!session) throw new Error("house session lost");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.headers.get("content-type")?.includes("event-stream")) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text.slice(0, 400) };
      }
      // A replayed request id whose generation already finished is answered
      // with the finished payload as plain JSON, not as a stream.
      const finished = res.ok && (parsed.chapter || parsed.story);
      return { status: res.status, event: finished ? "done" : "http", body: parsed };
    }
    let terminal: { event: string; body: Record<string, unknown> } | null = null;
    for (const frame of text.split("\n\n")) {
      let event = "message";
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trim());
      }
      if ((event === "done" || event === "error") && data.length) {
        try {
          terminal = { event, body: JSON.parse(data.join("\n")) };
        } catch { /* malformed frame */ }
      }
    }
    return terminal
      ? { status: res.status, ...terminal }
      : { status: res.status, event: "truncated", body: { raw: text.slice(-300) } };
  } finally {
    clearTimeout(timer);
  }
}
