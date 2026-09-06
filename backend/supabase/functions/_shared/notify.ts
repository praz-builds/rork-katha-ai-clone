/**
 * Delivering a notification to one user, in process.
 *
 * This is the body of the `send-push` edge function, lifted out so a generation
 * path can fire a notification directly instead of making an HTTP call to
 * another edge function to do it. The function stays and still delegates here,
 * so there is one implementation of token lookup, batching, receipt reading and
 * dead-token cleanup rather than two.
 *
 * The receipt half is the part worth protecting. Expo accepts a message and
 * reports separately, later, that APNs or FCM refused it, which is where an
 * uninstalled app actually surfaces. A sender that reads tickets and ignores
 * receipts accumulates dead tokens until it is rate limited, and the symptom
 * appears nowhere near the cause.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  chapterReadyMessage,
  chunk,
  draftWaitingMessage,
  EXPO_PUSH_BATCH_SIZE,
  type PushMessage,
  readExpoReceipts,
  sendExpoPushBatch,
  storyReadyMessage,
} from "./push.ts";

export type NotifyKind = "story_ready" | "chapter_ready" | "draft_waiting";

export interface NotifyInput {
  userId: string;
  kind: NotifyKind;
  storyId?: string | null;
  title?: string;
  chapterNumber?: number;
}

export interface NotifyResult {
  sent: number;
  pruned: number;
  reason?: "no_tokens";
}

export function notificationCopy(
  kind: NotifyKind,
  title: string,
  chapterNumber: number,
) {
  switch (kind) {
    case "chapter_ready":
      return chapterReadyMessage(title, chapterNumber);
    case "draft_waiting":
      return draftWaitingMessage(title, chapterNumber);
    default:
      return storyReadyMessage(title);
  }
}

/**
 * Send one notification to every device a user has registered.
 *
 * Never throws for an ordinary delivery problem: a user with no registered
 * device is a normal outcome, not an error, and a failed receipt read is a
 * cleanup that retries on the next send. Callers on a generation path must be
 * able to fire this without a failure reaching the story.
 */
export async function notifyUser(input: NotifyInput): Promise<NotifyResult> {
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: tokens, error: tokenError } = await serviceClient
    .from("push_tokens")
    .select("expo_token")
    .eq("user_id", input.userId);
  if (tokenError) throw tokenError;
  if (!tokens?.length) return { sent: 0, pruned: 0, reason: "no_tokens" };

  const chapterNumber = input.chapterNumber ?? 1;
  const copy = notificationCopy(
    input.kind,
    input.title?.trim() || "Your story",
    chapterNumber,
  );
  const messages: PushMessage[] = tokens.map((row) => ({
    to: row.expo_token as string,
    ...copy,
    data: {
      kind: input.kind,
      story_id: input.storyId ?? null,
      chapter_number: chapterNumber,
    },
  }));

  // Ticket ids are not positionally comparable to `messages`: a batch drops the
  // failures from its ticket list, and there are several batches. Carry the
  // mapping explicitly rather than reconstructing it from an index.
  const tokenByTicket = new Map<string, string>();
  const deadTokens: string[] = [];
  for (const batch of chunk(messages, EXPO_PUSH_BATCH_SIZE)) {
    const result = await sendExpoPushBatch(batch);
    for (const [ticketId, token] of result.ticketTokens) {
      tokenByTicket.set(ticketId, token);
    }
    deadTokens.push(...result.deadTokens);
  }
  const ticketIds = [...tokenByTicket.keys()];

  if (ticketIds.length) {
    try {
      const { deadTicketIds } = await readExpoReceipts(ticketIds);
      for (const id of deadTicketIds) {
        const token = tokenByTicket.get(id);
        if (token) deadTokens.push(token);
      }
    } catch (receiptError) {
      // A receipt read that fails is a cleanup we retry next send, never a
      // reason to report the notification as failed. It was delivered.
      console.warn("notify receipt read failed:", receiptError);
    }
  }

  if (deadTokens.length) {
    const { error: deleteError } = await serviceClient
      .from("push_tokens")
      .delete()
      .in("expo_token", [...new Set(deadTokens)]);
    if (deleteError) console.warn("notify cleanup failed:", deleteError);
  }

  return { sent: ticketIds.length, pruned: new Set(deadTokens).size };
}

/**
 * Fire a notification without letting it affect the work that triggered it.
 *
 * A story that generated successfully must not be reported as failed because a
 * push could not be delivered, and an unhandled rejection here would take the
 * isolate down after the chapter was already persisted. Every failure is
 * swallowed to a console line on purpose.
 */
export function notifyInBackground(input: NotifyInput): Promise<void> {
  return notifyUser(input)
    .then((result) => {
      if (result.reason === "no_tokens") return;
      console.log(
        `[notify] ${input.kind} sent=${result.sent} pruned=${result.pruned}`,
      );
    })
    .catch((error) => {
      console.warn(`[notify] ${input.kind} failed:`, error);
    });
}
