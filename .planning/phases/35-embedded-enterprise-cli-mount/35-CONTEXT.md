# Phase 35 Context — Embedded enterprise CLI mount

## User intent

Enterprise users already have an internal CLI, often built with Commander and Clack. They should not rebuild Atlas through a broad SDK. They should mount the full Atlas command tree under their own CLI namespace:

```sh
userCli acme <all atlas commands/options/flags>
```

Example desired wrapper code:

```ts
import { Command } from "commander";
import { attachAtlas } from "@moxellabs/atlas/commander";

const program = new Command();
program.name("userCli");

attachAtlas(program, {
  namespace: "acme",
  identityRoot: ".acme/knowledge",
  mcp: {
    name: "acme-mcp",
    title: "Acme Local Knowledge MCP",
    resourcePrefix: "acme",
  },
});

program.parse();
```

Result:

```sh
userCli acme setup
userCli acme add-repo
userCli acme search "auth middleware"
userCli acme mcp
userCli acme serve
userCli acme --help
```

Everything after `acme` must remain current Atlas commands, options, flags, validation, JSON output behavior, and exit-code behavior.

## Critical constraint

Do not invent new white-label/branding schema. Target only currently supported CLI options, environment variables, and config schema.

Current unsupported fields that must not appear in public wrapper schema unless separately implemented and tested in future work:

- `logo`
- `color`
- `docsUrl`
- `supportUrl`
- `productName`
- auth hooks / token callbacks

## Current supported Atlas identity/config surface

### CLI options

Defined in `apps/cli/src/index.ts`:

```txt
--atlas-identity-root <relative-path>
  Use custom identity root for artifacts/runtime storage

--atlas-mcp-name <name>
  Use explicit MCP server identity name

--atlas-mcp-title <title>
  Use explicit MCP server display title
```

Relevant global non-identity options:

```txt
--json
--verbose
--quiet
--cwd <path>
--config <path>
```

### Environment variables

Defined in `packages/config/src/env.schema.ts`:

```txt
ATLAS_CONFIG
ATLAS_CACHE_DIR
ATLAS_IDENTITY_ROOT
ATLAS_MCP_NAME
ATLAS_MCP_TITLE
ATLAS_LOG_LEVEL
ATLAS_CA_CERT_PATH
GHES_TOKEN
NODE_ENV
```

Docs/config loader also recognize GH credential fallbacks from raw env in relevant auth code paths:

```txt
GH_ENTERPRISE_TOKEN
GH_TOKEN
GITHUB_TOKEN
```

Those are credential/source concerns, not wrapper identity fields.

### Config identity schema

Defined in `packages/config/src/atlas-config.schema.ts`:

```ts
identity?: {
  root?: string;
  mcp?: {
    name?: string;
    title?: string;
    resourcePrefix?: string;
  };
}
```

### Identity precedence

From `packages/config/src/white-label/profile.ts` and `artifact-root.ts`:

Identity root precedence:

```txt
CLI --atlas-identity-root
→ env ATLAS_IDENTITY_ROOT
→ config identity.root
→ default .moxel/atlas
```

MCP name/title precedence:

```txt
CLI --atlas-mcp-name / --atlas-mcp-title
→ env ATLAS_MCP_NAME / ATLAS_MCP_TITLE
→ config identity.mcp.name / identity.mcp.title
→ default
```

MCP resource prefix:

```txt
config identity.mcp.resourcePrefix
→ default atlas
```

No current CLI/env knob exists for `resourcePrefix`.

### Defaults and validation

From `packages/config/src/white-label/artifact-root.ts`:

```ts
DEFAULT_ATLAS_IDENTITY_ROOT = ".moxel/atlas";
DEFAULT_ATLAS_RUNTIME_ROOT = "~/.moxel/atlas";
```

Custom identity root example:

```txt
identity.root = .acme/knowledge
runtime root = ~/.acme/knowledge
```

Identity root validation:

- relative path only
- no absolute path
- no `..` segment
- not `.`
- not empty

From `packages/config/src/white-label/profile.ts`:

```ts
DEFAULT_MCP_IDENTITY = {
  name: "atlas-mcp",
  title: "ATLAS Local Knowledge MCP",
  resourcePrefix: "atlas",
};
```

MCP name/resourcePrefix validation:

- lower-kebab identifier
- no path separators
- no `..`

## Wrapper schema for this phase

```ts
export type AtlasMountConfig = {
  /**
   * Commander namespace under enterprise CLI.
   * Example: `userCli acme search "query"`.
   * This is mount metadata only; it is not persisted Atlas identity.
   */
  namespace: string;

  /**
   * Existing Atlas identity root.
   * Maps to --atlas-identity-root / ATLAS_IDENTITY_ROOT / config identity.root.
   */
  identityRoot?: string;

  /** Existing MCP identity knobs. */
  mcp?: {
    /**
     * Maps to --atlas-mcp-name / ATLAS_MCP_NAME / config identity.mcp.name.
     * Must satisfy current lower-kebab identifier validation.
     */
    name?: string;

    /**
     * Maps to --atlas-mcp-title / ATLAS_MCP_TITLE / config identity.mcp.title.
     */
    title?: string;

    /**
     * Maps to config identity.mcp.resourcePrefix only.
     * No CLI/env knob currently exists.
     */
    resourcePrefix?: string;
  };

  /** Existing global config/env defaults only. */
  defaults?: {
    /** Maps to --config / ATLAS_CONFIG. */
    config?: string;

    /** Maps to ATLAS_CACHE_DIR / config cacheDir. */
    cacheDir?: string;

    /** Maps to ATLAS_LOG_LEVEL / config logLevel. */
    logLevel?: "debug" | "info" | "warn" | "error";

    /** Maps to ATLAS_CA_CERT_PATH. */
    caCertPath?: string;
  };
};
```

## Expected implementation direction

Minimal architecture:

```txt
existing command registrations
        ↓
createAtlasProgram(runtime, options?)
        ↓
createAtlasCommand(config)
        ↓
attachAtlas(program, config)
```

Potential exports:

```ts
export function createAtlasCommand(config: AtlasMountConfig): Command;
export function attachAtlas(
  program: Command,
  config: AtlasMountConfig,
): Command;
```

Standalone CLI should use same code path with default Atlas values:

```ts
const program = createAtlasProgram(runtime, {
  name: "atlas",
});
```

Mounted wrapper should create a command named by `namespace` and register all existing Atlas commands below it.

## Key implementation notes

- Refactor `apps/cli/src/index.ts` without duplicating command definitions.
- Current `createAtlasProgram(runtime)` hardcodes `.name("atlas")` and help header `atlas <command>\nRuntime defaults: ~/.moxel/atlas\n`; make those configurable while preserving defaults.
- `buildContext()` already accepts `identityRoot`, `mcpName`, and `mcpTitle` from global options and injects env overrides. Wrapper defaults should feed same mechanism or equivalent runtime env defaults.
- `mcp.resourcePrefix` cannot be represented by current CLI/global options; wrapper must either document config-only behavior or materialize a config overlay/file using existing config schema. Prefer simplest tested path.
- User-provided CLI flags should retain expected precedence over wrapper defaults.
- Existing `runCli()` behavior for binary entry point must remain unchanged.

## Acceptance tests to plan

- `attachAtlas(program, { namespace: "acme" })` exposes current Atlas subcommands under `acme`.
- `userCli acme --help` includes mounted command and existing Atlas commands.
- `userCli acme search --help` or representative subcommand help works with existing flags.
- Wrapper `identityRoot` produces same effective behavior as `--atlas-identity-root` default, while explicit user flag can override if designed to allow override.
- Wrapper `mcp.name` and `mcp.title` map to current MCP identity behavior.
- `mcp.resourcePrefix` works via config-only path or is documented and tested as requiring config.
- Standalone `atlas --help`, `atlas setup`, `atlas mcp`, JSON output, and unknown-command handling stay compatible.
- Type/schema test rejects or fails compile for invented fields in examples/docs (`logo`, `color`, `docsUrl`, `supportUrl`, `productName`, auth callbacks).

## Documentation to plan

Add enterprise wrapper docs showing one-minute setup with only current fields:

```ts
attachAtlas(program, {
  namespace: "acme",
  identityRoot: ".acme/knowledge",
  mcp: {
    name: "acme-mcp",
    title: "Acme Local Knowledge MCP",
    resourcePrefix: "acme",
  },
});
```

Docs must clearly say:

- `namespace` controls command path only: `userCli acme ...`.
- `identityRoot` controls Atlas artifact/runtime identity root.
- MCP fields affect MCP server metadata/resource display/skill alias identity according to existing behavior.
- Visual branding fields are not supported in this phase.
