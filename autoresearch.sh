#!/usr/bin/env bash
set -euo pipefail

export CI=
export TZ=UTC
export LANG=C.UTF-8
export LC_ALL=C.UTF-8

exec bun tooling/scripts/autoresearch-competitive-discovery.ts
