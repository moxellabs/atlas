---
phase: 41-production-readiness-uat
plan: 41-01
subsystem: release-gate
tags: [production-uat, cli-ux, diagnostics, release-gate]
requires:
  - phase: 40-command-ux-simplification
    provides: atlas next, repo add alias, setup no-branding guard
provides:
  - scripted production onboarding UAT
  - CI release gate for production usability regressions
  - troubleshooting release checklist
affects: [cli, ci, docs, release]
key-files:
  created:
    - tooling/scripts/production-uat.ts
  modified:
    - package.json
    - .github/workflows/ci.yml
    - docs/troubleshooting.md
requirements-completed: [PROD-UAT]
completed: 2026-04-29
---

# Phase 41 Plan 41-01: Add Production Onboarding UAT Scenarios Summary

Production onboarding UAT now validates Atlas against temporary private-monorepo-like Git fixtures before release.

## Accomplishments

- Added `tooling/scripts/production-uat.ts` using Bun temp dirs and local Git fixtures, with no external network calls.
- Added `bun run uat:production` package script.
- Added CI `Production onboarding UAT` step after distribution smoke.
- UAT asserts top-level command-order help, setup no-branding help, `atlas next` recommendations, `repo add` alias delegation, GitHub origin repo inference, current-checkout local-only branch init, live topology discovery, verbose `CLI_BUILD_FAILED` nested diagnostics, and doctor state-layer JSON.
- Added troubleshooting release-gate checklist mapping production incident issues to commands and share/redact guidance.

## Verification

- `bun run uat:production` — passed.
- `bun run typecheck` — passed.
- `bun run lint` — passed.

## Notes

- Fixture intentionally commits a malformed doc after live topology succeeds so UAT proves `build --json --verbose` exposes nested diagnostic cause and failing path.
- Version/global install confusion remains intentionally out of scope per user instruction.
