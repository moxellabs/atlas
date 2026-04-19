import { stableHash } from "../utils/hash";
import { stableJson } from "../utils/stable-json";

/** Inputs used to derive a stable chunk identity. */
export interface ChunkIdInput {
  /** Parent section ID when available. */
  sectionId?: string | undefined;
  /** Parent document ID. */
  docId: string;
  /** Chunk ordinal within the section or document. */
  ordinal: number;
}

/** Creates a deterministic structural chunk ID. */
export function createChunkId(input: ChunkIdInput): string {
  assertNonNegativeInteger(input.ordinal, "ordinal");
  return `chunk_${stableHash(stableJson(input)).slice(0, 24)}`;
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer.`);
  }
}
