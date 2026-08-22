const STALE_RESERVATION_MS = 5 * 60_000;

/** Validate a client-stable request identifier. */
export function parseRequestId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 128 ? normalized : null;
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
