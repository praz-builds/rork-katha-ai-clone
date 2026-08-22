const POSTGRES_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate any UUID representation accepted by the Postgres uuid type. */
export function parseUuid(value: unknown): string | null {
  return typeof value === "string" && POSTGRES_UUID_PATTERN.test(value)
    ? value
    : null;
}
