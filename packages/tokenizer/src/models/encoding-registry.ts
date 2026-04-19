import { getEncodingNameForModel, type TiktokenEncoding, type TiktokenModel } from "js-tiktoken";

import { TokenizerUnsupportedEncodingError } from "../errors";
import type { EncodingName, ModelName } from "../types";

/** Exact tokenizer encoding used by default for modern OpenAI model families. */
export const DEFAULT_ENCODING: EncodingName = "o200k_base";

/** Supported exact tokenizer encodings. */
export const SUPPORTED_ENCODINGS = ["o200k_base", "cl100k_base", "p50k_base", "r50k_base", "gpt2"] as const;

/** Returns true when a value is a supported exact tokenizer encoding. */
export function isSupportedEncoding(value: string): value is EncodingName {
  return (SUPPORTED_ENCODINGS as readonly string[]).includes(value);
}

/** Resolves either an explicit encoding or a supported model name to an encoding. */
export function resolveEncodingName(value: EncodingName | ModelName | undefined = DEFAULT_ENCODING): EncodingName {
  if (isSupportedEncoding(value)) {
    return value;
  }

  try {
    const resolved = getEncodingNameForModel(value as TiktokenModel);
    if (isSupportedEncoding(resolved)) {
      return resolved;
    }
  } catch (error) {
    throw new TokenizerUnsupportedEncodingError("Unsupported tokenizer encoding or model.", {
      operation: "resolveEncoding",
      encoding: value,
      cause: error
    });
  }

  throw new TokenizerUnsupportedEncodingError("Unsupported tokenizer encoding or model.", {
    operation: "resolveEncoding",
    encoding: value
  });
}

/** Converts a supported ATLAS encoding name to the js-tiktoken encoding type. */
export function toTiktokenEncoding(encoding: EncodingName): TiktokenEncoding {
  return encoding;
}
