import Constants from "expo-constants";
import { Platform } from "react-native";
import { bootstrapUser } from "@/lib/session";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

/**
 * Feedback about the app, from Profile's "Send feedback" sheet.
 *
 * Posts to the `app-feedback` edge function (migration 00098), NOT `feedback`:
 * that one posts a comment on a story. Works for a named account and for an
 * anonymous identity alike; `bootstrapUser` makes sure there is a session to
 * present.
 *
 * The request id is made once per message by the caller and reused on a
 * retry, so "Try again" after a dropped response cannot file it twice: the
 * server replays the first row.
 */

/** Mirrors `APP_FEEDBACK_CATEGORIES` in the edge function and the table's check. */
export const APP_FEEDBACK_CATEGORIES = ["bug", "idea", "story", "other"] as const;
export type AppFeedbackCategory = (typeof APP_FEEDBACK_CATEGORIES)[number];

/** The server's ceiling. The sheet counts toward it and stops there. */
export const APP_FEEDBACK_MAX_LENGTH = 2000;

export type AppFeedbackResult =
  | { ok: true }
  | { ok: false; reason: "rate_limited" | "failed" };

export function createAppFeedbackRequestId(): string {
  return `feedback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function statusOf(error: unknown): number | null {
  const status = (error as { context?: { status?: number } } | null)?.context?.status;
  return typeof status === "number" ? status : null;
}

export async function sendAppFeedback(input: {
  requestId: string;
  message: string;
  category: AppFeedbackCategory;
  screen?: string;
}): Promise<AppFeedbackResult> {
  const message = input.message.trim();
  if (!message || message.length > APP_FEEDBACK_MAX_LENGTH) {
    return { ok: false, reason: "failed" };
  }
  if (!isSupabaseConfigured) return { ok: false, reason: "failed" };
  try {
    await bootstrapUser();
    const { data, error } = await supabase.functions.invoke("app-feedback", {
      body: {
        request_id: input.requestId,
        message,
        category: input.category,
        app_version: Constants.expoConfig?.version ?? null,
        platform: Platform.OS,
        screen: input.screen ?? null,
      },
    });
    if (error) {
      return { ok: false, reason: statusOf(error) === 429 ? "rate_limited" : "failed" };
    }
    // Only an explicit yes from the server is a success. A 200 with any other
    // body is not something to thank the person for.
    return data?.sent === true ? { ok: true } : { ok: false, reason: "failed" };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
