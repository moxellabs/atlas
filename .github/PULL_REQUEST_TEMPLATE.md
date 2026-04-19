## Summary

-

## Validation

- [ ] `bun run typecheck`
- [ ] `bun run lint`
- [ ] `bun test`
- [ ] `bun run release:check`

## Public artifact

- [ ] Not applicable
- [ ] Rebuilt `.moxel/atlas` with `bun apps/cli/src/index.ts build --profile public`
- [ ] Verified with `bun apps/cli/src/index.ts artifact verify --fresh`

## Checklist

- [ ] Tests or docs updated for behavior changes.
- [ ] No credentials, tokens, private keys, private hostnames, proprietary docs, or customer data included.
- [ ] Examples use sanitized placeholders such as `<token>`.
- [ ] Local-first query-time guarantees preserved.
- [ ] Security-sensitive changes reviewed against `SECURITY.md`.

## Notes for reviewers

-
