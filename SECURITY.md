# Security Policy

Atlas is pre-1.0 for public release prep. Until first stable release, security fixes target the latest `main` branch and any explicitly announced supported release lines.

## Reporting a vulnerability

Do not open public issues for vulnerabilities.

Report privately to the maintainer/security contact before disclosure. Current private reporting placeholder:

- Email: security@moxellabs.com

If that address is not yet active, contact the repository owner through a private channel and include only enough detail to reproduce safely.

## What to include

- Affected Atlas version or commit.
- Operating system and Bun version.
- Reproduction steps using sanitized placeholders.
- Impact and affected surface: CLI, server, MCP, artifact import/build, docs, or release tooling.

Do not include real credentials, tokens, private keys, private hostnames, proprietary repository contents, or customer data. Redact sensitive values and use placeholders such as `<token>`.

## Local-first security expectations

Atlas retrieval, search, MCP, and HTTP read surfaces operate on local compiled corpus data. Remote reads happen only during explicit sync/build/add-repo workflows. Security reports that identify credential leakage, remote query-time fetches, unsafe artifact contents, or public artifact boundary failures are high priority.
