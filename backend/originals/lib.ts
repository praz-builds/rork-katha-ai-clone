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

const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENROUTER_API_KEY",
] as const;

/**
 * Credentials, from the process environment first and then from a dotenv
 * file: `ENV_FILE` if set, else `backend/.env` resolved from this script's own
 * location (never an absolute path, so any checkout works). Fails naming the
 * missing variables rather than with a filesystem error.
 */
export function loadEnv(): Record<string, string> {
  const fromFile: Record<string, string> = {};
  const file = Deno.env.get("ENV_FILE") ?? new URL("../.env", import.meta.url).pathname;
  try {
    for (const line of Deno.readTextFileSync(decodeURIComponent(file)).split("\n")) {
      if (!/^[A-Z_]+=/.test(line)) continue;
      const i = line.indexOf("=");
      fromFile[line.slice(0, i)] = line.slice(i + 1);
    }
  } catch { /* no file: the process environment must carry everything */ }
  const env: Record<string, string> = { ...fromFile };
  for (const key of REQUIRED_ENV) {
    const value = Deno.env.get(key);
    if (value) env[key] = value;
  }
  const missing = REQUIRED_ENV.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Missing ${missing.join(", ")}: set them in the environment or in ${file} (or ENV_FILE).`);
  }
  return env;
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

/** The house account's user id, looked up by email - never hard-coded. */
export async function houseUserId(): Promise<string> {
  const { data, error } = await service.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const user = data.users.find((u) => u.email === HOUSE_EMAIL);
  if (!user) throw new Error(`house account ${HOUSE_EMAIL} not found`);
  return user.id;
}

/**
 * THE QUALITY GATE, in one place. A story may be published only when a
 * reviewer read every chapter and passed it: a "publish" verdict in any
 * reviews*.jsonl, or its slug in approved.txt (a "fix" verdict whose edits were
 * applied and verified). The runner and both publish scripts all use this.
 */
export async function approvedSlugs(dir: URL): Promise<Set<string>> {
  const approved = new Set<string>();
  for await (const entry of Deno.readDir(dir)) {
    if (!/^reviews.*\.jsonl$/.test(entry.name)) continue;
    for (const line of (await Deno.readTextFile(new URL(entry.name, dir))).split("\n")) {
      try {
        const review = JSON.parse(line);
        if (review.verdict === "publish") approved.add(review.slug);
      } catch { /* blank or partial line */ }
    }
  }
  try {
    for (const slug of (await Deno.readTextFile(new URL("approved.txt", dir))).split("\n")) {
      if (slug.trim()) approved.add(slug.trim());
    }
  } catch { /* none yet */ }
  return approved;
}
