import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  chapterReadyMessage,
  chunk,
  EXPO_PUSH_BATCH_SIZE,
  isValidExpoToken,
  readExpoReceipts,
  sendExpoPushBatch,
  storyReadyMessage,
} from "./push.ts";

function jsonFetch(payload: unknown, ok = true): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(payload), { status: ok ? 200 : 500 }),
    )) as unknown as typeof fetch;
}

Deno.test("only real Expo tokens are accepted", () => {
  assert(isValidExpoToken("ExponentPushToken[abc-123_XYZ]"));
  assert(isValidExpoToken("ExpoPushToken[abc]"));
  assert(!isValidExpoToken("ExponentPushToken[]"));
  assert(!isValidExpoToken("fcm-token"));
  assert(!isValidExpoToken(""));
  assert(!isValidExpoToken(null));
  // A token carrying a quote would otherwise reach a SQL identity check.
  assert(!isValidExpoToken("ExponentPushToken[a'b]"));
});

Deno.test("batches never exceed the Expo request limit", () => {
  const items = Array.from({ length: 250 }, (_, i) => i);
  const batches = chunk(items, EXPO_PUSH_BATCH_SIZE);
  assertEquals(batches.length, 3);
  assert(batches.every((b) => b.length <= EXPO_PUSH_BATCH_SIZE));
  assertEquals(batches.flat().length, 250);
});

Deno.test("a ticket is paired with the token that produced it", async () => {
  const result = await sendExpoPushBatch(
    [
      { to: "ExponentPushToken[a]", title: "t", body: "b" },
      { to: "ExponentPushToken[b]", title: "t", body: "b" },
      { to: "ExponentPushToken[c]", title: "t", body: "b" },
    ],
    jsonFetch({
      data: [
        { status: "ok", id: "ticket-a" },
        {
          status: "error",
          message: "gone",
          details: { error: "DeviceNotRegistered" },
        },
        { status: "ok", id: "ticket-c" },
      ],
    }),
  );
  // The failure in the middle is exactly the case a positional index gets
  // wrong: ticket-c belongs to token c, not to token b.
  assertEquals(result.ticketTokens, [
    ["ticket-a", "ExponentPushToken[a]"],
    ["ticket-c", "ExponentPushToken[c]"],
  ]);
  assertEquals(result.deadTokens, ["ExponentPushToken[b]"]);
});

Deno.test("an unrelated ticket error does not prune the token", async () => {
  const result = await sendExpoPushBatch(
    [{ to: "ExponentPushToken[a]", title: "t", body: "b" }],
    jsonFetch({
      data: [{
        status: "error",
        message: "rate limited",
        details: { error: "MessageRateExceeded" },
      }],
    }),
  );
  assertEquals(result.deadTokens, []);
  assertEquals(result.ticketTokens, []);
});

Deno.test("an empty batch never reaches the network", async () => {
  const result = await sendExpoPushBatch(
    [],
    (() => {
      throw new Error("should not fetch");
    }) as unknown as typeof fetch,
  );
  assertEquals(result.ticketTokens, []);
});

Deno.test("receipts surface tokens that died after acceptance", async () => {
  const { deadTicketIds } = await readExpoReceipts(
    ["ticket-a", "ticket-b"],
    jsonFetch({
      data: {
        "ticket-a": { status: "ok" },
        "ticket-b": {
          status: "error",
          details: { error: "DeviceNotRegistered" },
        },
      },
    }),
  );
  assertEquals(deadTicketIds, ["ticket-b"]);
});

Deno.test("generation notifications use their own channel", () => {
  assertEquals(storyReadyMessage("Bellwether House").channelId, "generation");
  assertEquals(
    chapterReadyMessage("Bellwether House", 3).channelId,
    "generation",
  );
  // A user must be able to mute follow updates without muting the thing they
  // paid for and explicitly asked to be told about.
  assert(chapterReadyMessage("Bellwether House", 3).body.includes("Chapter 3"));
});

/* ── Batching and failure edges ─────────────────────────────────────────── */

Deno.test("a batch exactly at the limit is one request, not two", () => {
  const items = Array.from({ length: EXPO_PUSH_BATCH_SIZE }, (_, i) => i);
  assertEquals(chunk(items, EXPO_PUSH_BATCH_SIZE).length, 1);
  assertEquals(chunk([...items, 0], EXPO_PUSH_BATCH_SIZE).length, 2);
  // An empty list must not produce an empty request.
  assertEquals(chunk([], EXPO_PUSH_BATCH_SIZE).length, 0);
});

Deno.test("a short ticket list never pairs a ticket with the wrong token", async () => {
  // Expo returning fewer tickets than messages is the case where a positional
  // pairing quietly attributes one device's failure to another device.
  const { ticketTokens, deadTokens } = await sendExpoPushBatch(
    [
      { to: "ExpoPushToken[a]", title: "t", body: "b" },
      { to: "ExpoPushToken[b]", title: "t", body: "b" },
      { to: "ExpoPushToken[c]", title: "t", body: "b" },
    ],
    jsonFetch({
      data: [
        { status: "ok", id: "ticket-a" },
        {
          status: "error",
          message: "gone",
          details: { error: "DeviceNotRegistered" },
        },
      ],
    }),
  );
  assertEquals(ticketTokens, [["ticket-a", "ExpoPushToken[a]"]]);
  assertEquals(deadTokens, ["ExpoPushToken[b]"]);
});

Deno.test("more tickets than messages are ignored rather than mispaired", async () => {
  const { ticketTokens } = await sendExpoPushBatch(
    [{ to: "ExpoPushToken[a]", title: "t", body: "b" }],
    jsonFetch({
      data: [
        { status: "ok", id: "ticket-a" },
        { status: "ok", id: "ticket-ghost" },
      ],
    }),
  );
  assertEquals(ticketTokens, [["ticket-a", "ExpoPushToken[a]"]]);
});

Deno.test("a refused send is raised, not silently counted as delivered", async () => {
  let threw = false;
  try {
    await sendExpoPushBatch(
      [{ to: "ExpoPushToken[a]", title: "t", body: "b" }],
      jsonFetch({}, false),
    );
  } catch {
    threw = true;
  }
  assert(threw);
});

Deno.test("a malformed push response yields no tickets and no pruning", async () => {
  const { ticketTokens, deadTokens } = await sendExpoPushBatch(
    [{ to: "ExpoPushToken[a]", title: "t", body: "b" }],
    jsonFetch({ errors: [{ code: "SOMETHING_ELSE" }] }),
  );
  assertEquals(ticketTokens, []);
  // Nothing was reported dead, so nothing may be deleted.
  assertEquals(deadTokens, []);
});

Deno.test("an empty ticket list never reaches the receipts endpoint", async () => {
  let called = false;
  const { deadTicketIds } = await readExpoReceipts(
    [],
    (() => {
      called = true;
      return Promise.resolve(new Response("{}"));
    }) as unknown as typeof fetch,
  );
  assertEquals(deadTicketIds, []);
  assert(!called);
});

Deno.test("a delivered receipt prunes nothing", async () => {
  const { deadTicketIds } = await readExpoReceipts(
    ["ticket-a"],
    jsonFetch({ data: { "ticket-a": { status: "ok" } } }),
  );
  assertEquals(deadTicketIds, []);
});

Deno.test("a receipt error that is not a dead device prunes nothing", async () => {
  // MessageRateExceeded is a throttle, not a device that is gone. Deleting the
  // token would lose a live subscriber over a transient condition.
  const { deadTicketIds } = await readExpoReceipts(
    ["ticket-a"],
    jsonFetch({
      data: {
        "ticket-a": {
          status: "error",
          details: { error: "MessageRateExceeded" },
        },
      },
    }),
  );
  assertEquals(deadTicketIds, []);
});

Deno.test("the copy names the story the user is waiting on", () => {
  assert(
    storyReadyMessage("Bellwether House").body.includes("Bellwether House"),
  );
  assert(
    chapterReadyMessage("Bellwether House", 7).body.includes(
      "Bellwether House",
    ),
  );
});
