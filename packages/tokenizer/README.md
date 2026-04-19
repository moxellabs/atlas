# @atlas/tokenizer

Exact token accounting and chunking for ATLAS.

This package wraps `js-tiktoken`, resolves supported encodings/model aliases, validates token budgets, splits oversized text, applies overlap, and builds tokenized chunks from canonical sections.

## Runtime Role

- Provides exact encode/decode/count behavior for supported encodings.
- Preserves section boundaries when possible.
- Splits oversized content by structure before exact-token fallback.
- Applies bounded token overlap.
- Emits deterministic chunk IDs, ordinals, diagnostics, and token counts.

## Public API

- Encoding: `createTextEncoder`, `TiktokenTextEncoder`, `resolveEncodingName`, `DEFAULT_ENCODING`
- Budget helpers: `checkBudget`, `remainingBudget`, `availableTokens`, `canAppend`
- Chunking: `chunkBySection`, `splitByBudget`, `applyOverlap`
- Tokenizer errors and chunking/encoding types

## Development

```bash
bun --cwd packages/tokenizer run typecheck
bun test packages/tokenizer
```
