const STALE_RESERVATION_MS = 5 * 60_000;

/** Validate a client-stable request identifier. */
export function parseRequestId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 128 ? normalized : null;
}

/** Parse a request body only when it contains a JSON object. */
export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** Validate a UUID before passing it to Postgres UUID parameters. */
export function parseUuid(value: unknown): string | null {
  return typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(value)
    ? value
    : null;
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
