import { stableHash } from "../utils/hash";
import { stableJson } from "../utils/stable-json";

/** Inputs used to derive a stable section identity. */
export interface SectionIdInput {
  /** Parent document ID. */
  docId: string;
  /** Heading path for the section. */
  headingPath: readonly string[];
  /** Section ordinal within the document. */
  ordinal: number;
}

/** Creates a deterministic structural section ID. */
export function createSectionId(input: SectionIdInput): string {
  assertNonNegativeInteger(input.ordinal, "ordinal");
  return `section_${stableHash(stableJson(input)).slice(0, 24)}`;
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer.`);
  }
}
