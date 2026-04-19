# Tokenizer Models Module

The models module defines supported token encodings and aliases.

## Responsibilities

- Default encoding.
- Supported encoding names.
- Model-to-encoding resolution.
- Validation of unsupported encodings.

## Invariants

Encoding registry changes affect token counts and should be treated as retrieval behavior changes.
