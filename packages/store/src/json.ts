/** Serializes structured values for inspectable SQLite JSON text columns. */
export function encodeJson(value: unknown): string {
  return JSON.stringify(value);
}

/** Parses a JSON column and returns undefined only when the column is nullish or empty. */
export function decodeJson<T>(value: string | null | undefined, label: string): T | undefined {
  if (value === null || value === undefined || value.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(value) as T;
  } catch (cause) {
    throw new TypeError(`${label} must contain valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

/** Parses an array JSON column and fails closed to an empty array only when the column is nullish. */
export function decodeJsonArray<T>(value: string | null | undefined, label: string): T[] {
  if (value === null || value === undefined || value.length === 0) {
    return [];
  }
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new TypeError(`${label} must contain a JSON array.`);
  }
  return parsed as T[];
}
