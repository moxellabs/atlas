# Tokenizer Encode Module

The encode module wraps exact token encoding and budget helpers.

## Responsibilities

- Create text encoders.
- Count tokens.
- Decode encoded text where supported.
- Validate and calculate token budgets.

## Invariants

Encoding behavior should be exact for supported encodings. Budget helpers should avoid negative or misleading remaining-token results.
