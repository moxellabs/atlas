import { createHash } from "node:crypto";

/** Returns a deterministic SHA-256 hex digest for string or binary input. */
export function stableHash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
