import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  CHAPTER_METADATA_SCHEMA,
  chapterLengthVerdict,
  chapterTokenBudget,
  parseSseData,
  StreamCommittedError,
  streamChapterProse,
  trimToParagraph,
} from "./story-stream.ts";
import { STORY_OUTPUT_JSON_SCHEMA } from "./story_schema.ts";
import { AllProvidersFailedError } from "./llm.ts";
import { wordBandBounds } from "./types.ts";

// ---------------------------------------------------------------------------
// SSE frame parsing
//
// Every one of these cases was observed on a live OpenRouter stream. The
// keep-alive comments and the role-only first frame are the two that quietly
// corrupt a chapter if they are treated as content.
// ---------------------------------------------------------------------------

Deno.test("a content delta is extracted", () => {
  const frame = parseSseData(
    'data: {"model":"meta/muse-spark-1.3","choices":[{"delta":{"content":"The ferry"}}]}',
  );
  assertEquals(frame.delta, "The ferry");
  assertEquals(frame.done, false);
  assertEquals(frame.model, "meta/muse-spark-1.3");
});

Deno.test("OpenRouter keep-alive comments carry no content", () => {
  // Sent while a slow model spins up. These arrive *before* any prose, so
  // treating one as content would put ": OPENROUTER PROCESSING" into the story.
  assertEquals(parseSseData(": OPENROUTER PROCESSING").delta, undefined);
  assertEquals(parseSseData(": OPENROUTER PROCESSING").done, false);
});

Deno.test("the role-only opening frame carries no content", () => {
  const frame = parseSseData(
    'data: {"choices":[{"delta":{"role":"assistant"}}]}',
  );
  assertEquals(frame.delta, undefined);
});

Deno.test("a null content delta is not a string", () => {
  const frame = parseSseData('data: {"choices":[{"delta":{"content":null}}]}');
  assertEquals(frame.delta, undefined);
});

Deno.test("[DONE] terminates the stream", () => {
  assertEquals(parseSseData("data: [DONE]").done, true);
});

Deno.test("blank lines and non-data lines are ignored", () => {
  assertEquals(parseSseData("").done, false);
  assertEquals(parseSseData("event: message").delta, undefined);
});

Deno.test("a malformed frame is skipped rather than thrown", () => {
  // A provider bug should cost at most one token of prose, never the chapter.
  const frame = parseSseData("data: {not json");
  assertEquals(frame.delta, undefined);
  assertEquals(frame.done, false);
});

Deno.test("finish_reason is carried through", () => {
  const frame = parseSseData(
    'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
  );
  assertEquals(frame.finishReason, "length");
});

// ---------------------------------------------------------------------------
// Paragraph trimming
// ---------------------------------------------------------------------------

Deno.test("trimming cuts back to the last complete paragraph", () => {
  const text = "First para.\n\nSecond para.\n\nThird para that was cut mid-";
  assertEquals(trimToParagraph(text), "First para.\n\nSecond para.");
});

Deno.test("a single unfinished paragraph is kept rather than emptied", () => {
  // Returning "" here would hand the caller an empty chapter, which is worse
  // than an unfinished one.
  const text = "One paragraph that never fini";
  assertEquals(trimToParagraph(text), text);
});

// ---------------------------------------------------------------------------
// The physical output cap
// ---------------------------------------------------------------------------

Deno.test("the token budget leaves room for a chapter at the tolerated ceiling", () => {
  // The cap is a runaway guard, not band enforcement. A chapter written to the
  // top of its tolerated band must never meet it, because truncating a chapter
  // the reader is already reading produces a story that simply stops.
  const band = { min: 1200, max: 1600 };
  const tolerated = wordBandBounds(band).max;
  const budget = chapterTokenBudget(band);
  // Even at a generous 1.5 tokens/word, the tolerated ceiling fits well inside.
  assert(
    budget > tolerated * 1.5,
    `budget ${budget} must clear ${tolerated} words comfortably`,
  );
});

Deno.test("a longer band gets a larger budget", () => {
  const short = chapterTokenBudget({ min: 600, max: 900 });
  const long = chapterTokenBudget({ min: 2000, max: 2600 });
  assert(long > short);
});

Deno.test("an absent band still gets a bounded budget", () => {
  const budget = chapterTokenBudget(undefined);
  assert(budget > 0 && Number.isFinite(budget));
});

// ---------------------------------------------------------------------------
// Length verdict
// ---------------------------------------------------------------------------

Deno.test("a chapter inside its band is usable and undrifted", () => {
  const text = Array.from({ length: 1300 }, () => "word").join(" ");
  const verdict = chapterLengthVerdict(text, { min: 1200, max: 1600 });
  assertEquals(verdict.words, 1300);
  assertEquals(verdict.usable, true);
  assertEquals(verdict.drifted, false);
});

Deno.test("a chapter past the band but inside tolerance is drifted, not unusable", () => {
  const text = Array.from({ length: 1800 }, () => "word").join(" ");
  const verdict = chapterLengthVerdict(text, { min: 1200, max: 1600 });
  assertEquals(verdict.usable, true);
  assertEquals(verdict.drifted, true);
});

Deno.test("a runaway chapter is reported unusable", () => {
  // The observed failure: this model wrote 2,056-2,331 words against a
  // 1,200-1,600 band. The streamed path cannot retry it, so it must at least
  // be visible.
  const text = Array.from({ length: 2331 }, () => "word").join(" ");
  const verdict = chapterLengthVerdict(text, { min: 1200, max: 1600 });
  assertEquals(verdict.usable, false);
  assertEquals(verdict.drifted, true);
});

// ---------------------------------------------------------------------------
// The metadata schema, derived rather than restated
// ---------------------------------------------------------------------------

Deno.test("metadata carries every story field except the two the stream produces", () => {
  const streamed = ["chapter_body", "word_count"];
  for (const key of STORY_OUTPUT_JSON_SCHEMA.required) {
    if (streamed.includes(key)) {
      assert(
        !CHAPTER_METADATA_SCHEMA.required.includes(key),
        `${key} is produced by the stream and must not be asked for again`,
      );
    } else {
      assert(
        CHAPTER_METADATA_SCHEMA.required.includes(key),
        `${key} would be silently lost on the streamed path`,
      );
    }
  }
});

Deno.test("series_state survives into the metadata schema intact", () => {
  // This is the field a series cannot be continued without, and the reason the
  // metadata call is structured rather than streamed.
  const seriesState = (CHAPTER_METADATA_SCHEMA.properties as Record<
    string,
    { required?: string[] }
  >).series_state;
  assertEquals(
    seriesState.required,
    [...STORY_OUTPUT_JSON_SCHEMA.properties.series_state.required],
  );
});

// ---------------------------------------------------------------------------
// The commit boundary
//
// The single most important behaviour in this module: a provider may be
// swapped before the reader has seen prose, and never after.
// ---------------------------------------------------------------------------

function sseResponse(frames: string[], status = 200): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const frame of frames) {
        controller.enqueue(encoder.encode(`${frame}\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { status });
}

async function withStubbedFetch<T>(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  run: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const originalKey = Deno.env.get("OPENROUTER_API_KEY");
  Deno.env.set("OPENROUTER_API_KEY", "test-key");
  globalThis.fetch = ((url: string | URL | Request, init: RequestInit) =>
    Promise.resolve(handler(String(url), init ?? {}))) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
    if (originalKey === undefined) Deno.env.delete("OPENROUTER_API_KEY");
    else Deno.env.set("OPENROUTER_API_KEY", originalKey);
  }
}

Deno.test("prose is streamed in order and returned whole", async () => {
  const deltas: string[] = [];
  const result = await withStubbedFetch(
    () =>
      sseResponse([
        ': OPENROUTER PROCESSING',
        'data: {"choices":[{"delta":{"role":"assistant"}}]}',
        'data: {"model":"meta/muse-spark-1.3","choices":[{"delta":{"content":"The ferry "}}]}',
        'data: {"choices":[{"delta":{"content":"stopped coming."}}]}',
        "data: [DONE]",
      ]),
    () =>
      streamChapterProse({
        systemPrompt: "sys",
        userPrompt: "usr",
        onDelta: (c) => deltas.push(c),
      }),
  );
  assertEquals(deltas, ["The ferry ", "stopped coming."]);
  assertEquals(result.text, "The ferry stopped coming.");
  assertEquals(result.truncated, false);
});

Deno.test("a data frame split across two reads is not lost", async () => {
  // A `data:` line straddling two TCP reads is normal. Parsing the half would
  // silently drop a token of the story.
  const deltas: string[] = [];
  const result = await withStubbedFetch(
    () => {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"cont'),
          );
          controller.enqueue(encoder.encode('ent":"whole word"}}]}\n'));
          controller.enqueue(encoder.encode("data: [DONE]\n"));
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    },
    () =>
      streamChapterProse({
        systemPrompt: "sys",
        userPrompt: "usr",
        onDelta: (c) => deltas.push(c),
      }),
  );
  assertEquals(deltas, ["whole word"]);
  assertEquals(result.text, "whole word");
});

Deno.test("a provider that fails before the first token falls back silently", async () => {
  const seen: string[] = [];
  const deltas: string[] = [];
  const result = await withStubbedFetch(
    (_url, init) => {
      const model = JSON.parse(String(init.body)).model as string;
      seen.push(model);
      // The leader 500s before writing anything. The reader is still on the
      // loader, so swapping providers is invisible and correct.
      if (seen.length === 1) return new Response("upstream boom", { status: 500 });
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"second provider"}}]}',
        "data: [DONE]",
      ]);
    },
    () =>
      streamChapterProse({
        systemPrompt: "sys",
        userPrompt: "usr",
        onDelta: (c) => deltas.push(c),
      }),
  );
  assertEquals(result.text, "second provider");
  assertEquals(deltas, ["second provider"]);
  assert(seen.length === 2, "the second model should have been tried");
});

Deno.test("a provider that fails AFTER the first token is terminal", async () => {
  // The rule the whole module exists to enforce. Falling back here would
  // rewrite prose the reader has already read.
  const deltas: string[] = [];
  let attempts = 0;
  const error = await withStubbedFetch(
    () => {
      attempts += 1;
      const encoder = new TextEncoder();
      // The chunk must be *consumed* before the error, otherwise the reader
      // never sees it and this stops testing the commit boundary at all.
      // Enqueueing and erroring in the same `start` tick drops the chunk.
      let delivered = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!delivered) {
            delivered = true;
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"content":"already read"}}]}\n',
              ),
            );
            return;
          }
          controller.error(new Error("connection reset mid-stream"));
        },
      });
      return new Response(body, { status: 200 });
    },
    () =>
      assertRejects(
        () =>
          streamChapterProse({
            systemPrompt: "sys",
            userPrompt: "usr",
            onDelta: (c) => deltas.push(c),
          }),
        StreamCommittedError,
      ),
  );
  assertEquals(deltas, ["already read"]);
  assertEquals(attempts, 1, "no fallback may be attempted after commit");
  assertStringIncludes(error.message, "after streaming had begun");
});

Deno.test("onCommit fires exactly once, on the first token", async () => {
  const commits: string[] = [];
  await withStubbedFetch(
    () =>
      sseResponse([
        'data: {"model":"meta/muse-spark-1.3","choices":[{"delta":{"content":"a"}}]}',
        'data: {"choices":[{"delta":{"content":"b"}}]}',
        'data: {"choices":[{"delta":{"content":"c"}}]}',
        "data: [DONE]",
      ]),
    () =>
      streamChapterProse({
        systemPrompt: "sys",
        userPrompt: "usr",
        onDelta: () => {},
        onCommit: (m) => commits.push(m),
      }),
  );
  assertEquals(commits, ["meta/muse-spark-1.3"]);
});

Deno.test("a stream that produces no content at all is a provider failure", async () => {
  // 200 with an empty body is the shape a schema-ignoring model returns. It
  // must not persist as an empty chapter.
  await withStubbedFetch(
    () => sseResponse(["data: [DONE]"]),
    () =>
      assertRejects(
        () =>
          streamChapterProse({
            systemPrompt: "sys",
            userPrompt: "usr",
            onDelta: () => {},
          }),
        AllProvidersFailedError,
      ),
  );
});

Deno.test("hitting the output cap trims to a paragraph and reports truncation", async () => {
  const result = await withStubbedFetch(
    () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Done para.\\n\\nCut para that stops"}}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
        "data: [DONE]",
      ]),
    () =>
      streamChapterProse({
        systemPrompt: "sys",
        userPrompt: "usr",
        onDelta: () => {},
      }),
  );
  assertEquals(result.truncated, true);
  assertEquals(result.text, "Done para.");
});
