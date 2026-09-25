// The request shape and the verdict relay for app feedback. The bound and the
// replay are SQL's, and are tested against real Postgres in
// `migrations/00098_app_feedback_test.ts`.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AppFeedbackInput,
  createHandler,
  MAX_MESSAGE_LENGTH,
  parseAppFeedback,
  verdictFrom,
} from "./index.ts";

Deno.test("a message and a request id are all that is required", () => {
  assertEquals(parseAppFeedback({ request_id: "r1", message: "  hi  " }), {
    ok: true,
    value: {
      requestId: "r1",
      category: "other",
      message: "hi",
      appVersion: null,
      platform: null,
      screen: null,
    },
  });
});

Deno.test("an empty, missing or over-long message is refused", () => {
  for (const message of [undefined, "", "   ", 42]) {
    assertEquals(
      parseAppFeedback({ request_id: "r1", message }).ok,
      false,
      String(message),
    );
  }
  assertEquals(
    parseAppFeedback({
      request_id: "r1",
      message: "a".repeat(MAX_MESSAGE_LENGTH + 1),
    }).ok,
    false,
  );
  assertEquals(
    parseAppFeedback({
      request_id: "r1",
      message: "a".repeat(MAX_MESSAGE_LENGTH),
    }).ok,
    true,
  );
});

Deno.test("a missing request id is refused", () => {
  assertEquals(parseAppFeedback({ message: "hi" }).ok, false);
});

Deno.test("bad context is dropped, never a reason to refuse the feedback", () => {
  const parsed = parseAppFeedback({
    request_id: "r1",
    message: "hi",
    category: "rant",
    platform: "windows",
    app_version: "x".repeat(100),
    screen: 7,
  });
  assertEquals(parsed.ok, true);
  if (!parsed.ok) return;
  assertEquals(parsed.value.category, "other");
  assertEquals(parsed.value.platform, null);
  assertEquals(parsed.value.appVersion?.length, 32);
  assertEquals(parsed.value.screen, null);
});

Deno.test("known context is kept", () => {
  const parsed = parseAppFeedback({
    request_id: "r1",
    message: "hi",
    category: "bug",
    platform: "android",
    app_version: "1.0.0",
    screen: "profile",
  });
  assertEquals(parsed.ok && parsed.value, {
    requestId: "r1",
    category: "bug",
    message: "hi",
    appVersion: "1.0.0",
    platform: "android",
    screen: "profile",
  });
});

Deno.test("the verdict: filed, replayed, rate limited, or a 500", () => {
  assertEquals(verdictFrom({ id: "x", replayed: false, rate_limited: false }), {
    status: 200,
    body: { sent: true, replayed: false },
  });
  assertEquals(
    verdictFrom('{"id":"x","replayed":true,"rate_limited":false}').body,
    { sent: true, replayed: true },
  );
  assertEquals(verdictFrom({ rate_limited: true }).status, 429);
  for (const bad of [null, {}, "nope", { rate_limited: false }]) {
    assertEquals(verdictFrom(bad).status, 500, JSON.stringify(bad));
  }
});

function post(body: unknown, auth = "Bearer t"): Request {
  return new Request("http://localhost/app-feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify(body),
  });
}

Deno.test("the handler files as the JWT's user and answers 429 when refused", async () => {
  const calls: { userId: string; input: AppFeedbackInput }[] = [];
  let limited = false;
  const handler = createHandler({
    userIdFor: (header) => Promise.resolve(header === "Bearer t" ? "u1" : null),
    submit: (userId, input) => {
      calls.push({ userId, input });
      return Promise.resolve({
        data: limited
          ? { rate_limited: true }
          : { id: "f1", replayed: false, rate_limited: false },
        error: null,
      });
    },
  });

  // A user id in the body is ignored: identity is the JWT's.
  const ok = await handler(
    post({ request_id: "r1", message: "hi", user_id: "u2" }),
  );
  assertEquals(ok.status, 200);
  assertEquals(await ok.json(), { sent: true, replayed: false });
  assertEquals(calls[0].userId, "u1");

  limited = true;
  const refused = await handler(post({ request_id: "r2", message: "hi" }));
  assertEquals(refused.status, 429);
  assertEquals((await refused.json()).rate_limited, true);

  const anonymous = await handler(
    post({ request_id: "r3", message: "hi" }, "Bearer bad"),
  );
  assertEquals(anonymous.status, 401);
  await anonymous.body?.cancel();

  const invalid = await handler(post({ request_id: "r4", message: "" }));
  assertEquals(invalid.status, 400);
  await invalid.body?.cancel();
  assertEquals(calls.length, 2);
});

Deno.test("a database error is a 500, not a false success", async () => {
  const handler = createHandler({
    userIdFor: () => Promise.resolve("u1"),
    submit: () => Promise.resolve({ data: null, error: new Error("down") }),
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await handler(post({ request_id: "r1", message: "hi" }));
    assertEquals(response.status, 500);
    await response.body?.cancel();
  } finally {
    console.error = originalError;
  }
});
