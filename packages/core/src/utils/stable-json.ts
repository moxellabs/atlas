/**
 * Serializes JSON-compatible data with deterministic object key ordering.
 *
 * This helper is intentionally narrow: it is for stable hashing and tests, not
 * for preserving non-JSON runtime values such as functions, symbols, or class
 * instances.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(normalizeForStableJson(value));
}

function normalizeForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForStableJson(item));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, normalizeForStableJson(entryValue)])
    );
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}
