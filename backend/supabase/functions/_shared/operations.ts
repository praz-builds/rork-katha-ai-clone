const STALE_RESERVATION_MS = 5 * 60_000;

export { parseUuid } from "./uuid.ts";

/** Validate a client-stable request identifier. */
export function parseRequestId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 128 ? normalized : null;
}

/**
 * Largest request body any generation endpoint will read.
 *
 * Generously above the sum of every field's own cap - a 1,000-character idea,
 * four characters at 500 characters a field, ten moments - so no legitimate
 * request is near it. `publish-story` is the outlier because it carries whole
 * chapters; it sets its own limit.
 */
export const MAX_REQUEST_BYTES = 128 * 1024;

/**
 * Read a request body, giving up as soon as it exceeds `maxBytes`.
 *
 * Counted in UTF-8 bytes, which is what a size limit means. `String.length`
 * counts UTF-16 code units, so a body of multi-byte characters could be several
 * times the limit and still pass it — and story ideas are routinely non-Latin,
 * which makes that the normal case rather than an adversarial one.
 *
 * Returns null when the limit is exceeded, so the caller's existing
 * "malformed body" path handles it with no new branch.
 */
async function readBounded(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        // Cancelling tells the peer to stop sending rather than reading a
        // large body to completion only to discard it.
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

/**
 * Parse a request body only when it contains a JSON object, and only when it
 * is small enough to be one of ours.
 *
 * The field-level caps in `validation.ts` all run *after* the body is parsed,
 * so without this a 50 MB payload was fully read and deserialized into the
 * isolate's memory before anything rejected it. Checking `Content-Length`
 * first costs nothing on the normal path and refuses the abusive one before a
 * byte is deserialized; the post-parse check catches a chunked body that
 * declared no length.
 */
export async function readJsonObject(
  request: Request,
  maxBytes: number = MAX_REQUEST_BYTES,
): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  try {
    // Read with the limit enforced, not after it.
    //
    // `await request.text()` buffers the entire body first, so a body that
    // declares no `Content-Length` — a chunked upload — is fully in memory
    // before anything measures it, and the check afterwards protects nothing.
    // Reading chunk by chunk and stopping at the limit is what actually bounds
    // the isolate's memory.
    const raw = await readBounded(request, maxBytes);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** Normalize unknown failures for logs and persisted operation state. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Identify abandoned reservations that should be reconciled on retry. */
export function isStaleReservation(updatedAt: string): boolean {
  const updatedAtMs = Date.parse(updatedAt);
  return Number.isFinite(updatedAtMs) &&
    Date.now() - updatedAtMs >= STALE_RESERVATION_MS;
}
