import { getEncoding } from "js-tiktoken";

import { TokenizerEncodeError, TokenizerInitializationError } from "../errors";
import { resolveEncodingName, toTiktokenEncoding } from "../models/encoding-registry";
import type { EncodedText, EncodingName, ModelName, TextEncoder } from "../types";

/** js-tiktoken backed exact text encoder. */
export class TiktokenTextEncoder implements TextEncoder {
  readonly name: EncodingName;
  private readonly encoder: ReturnType<typeof getEncoding>;

  constructor(encodingOrModel?: EncodingName | ModelName) {
    this.name = resolveEncodingName(encodingOrModel);
    try {
      this.encoder = getEncoding(toTiktokenEncoding(this.name));
    } catch (error) {
      throw new TokenizerInitializationError("Failed to initialize tokenizer encoder.", {
        operation: "initializeEncoder",
        encoding: this.name,
        cause: error
      });
    }
  }

  /** Encodes text into exact token IDs and count. */
  encode(text: string): EncodedText {
    try {
      const tokenIds = this.encoder.encode(text);
      return {
        encoding: this.name,
        tokenIds,
        tokenCount: tokenIds.length
      };
    } catch (error) {
      throw new TokenizerEncodeError("Failed to encode text.", {
        operation: "encode",
        encoding: this.name,
        cause: error
      });
    }
  }

  /** Decodes exact token IDs back to text. */
  decode(tokenIds: readonly number[]): string {
    try {
      return this.encoder.decode([...tokenIds]);
    } catch (error) {
      throw new TokenizerEncodeError("Failed to decode token IDs.", {
        operation: "decode",
        encoding: this.name,
        cause: error
      });
    }
  }

  /** Counts exact tokens in text. */
  count(text: string): number {
    return this.encode(text).tokenCount;
  }
}

/** Creates an exact text encoder for an encoding or supported model name. */
export function createTextEncoder(encodingOrModel?: EncodingName | ModelName): TextEncoder {
  return new TiktokenTextEncoder(encodingOrModel);
}
