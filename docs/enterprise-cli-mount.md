---
title: Enterprise CLI Mount
description: Mount Atlas commands under an existing Commander CLI namespace.
audience: [consumer, maintainer]
purpose: [guide, reference]
visibility: public
order: 55
---

# Enterprise CLI Mount

Enterprise CLIs can mount Atlas under an existing Commander program with `@moxellabs/atlas/commander`. The wrapper owns product naming, command placement, distribution, and enterprise defaults; Atlas owns the maintained command tree, validation, JSON output, exit codes, local artifact build, search, MCP, and server behavior.

Use this when an internal CLI such as `acme` or `userCli` should expose local knowledge commands without asking users to install and learn the standalone `atlas` binary.

## Install

```sh
npm install @moxellabs/atlas commander
```

Atlas declares `commander` as a dependency, but most host CLIs already own their Commander version. Keep the wrapper and Atlas on compatible Commander versions and import the mount API from the subpath export:

```ts
import { attachAtlas, createAtlasCommand } from "@moxellabs/atlas/commander";
```

## One-minute setup

```ts
import { Command } from "commander";
import { attachAtlas } from "@moxellabs/atlas/commander";

const program = new Command();
program.name("userCli");

attachAtlas(program, {
  namespace: "knowledge",
  displayName: "knowledge",
  identityRoot: ".acme/knowledge",
  mcp: {
    name: "acme-knowledge",
    title: "Acme Local Knowledge MCP",
    resourcePrefix: "acme",
  },
  defaults: {
    config: ".acme/knowledge/config.yaml",
    cacheDir: ".acme/knowledge/cache",
    logLevel: "warn",
  },
});

program.parse();
```

Result:

```sh
userCli knowledge setup
userCli knowledge repo add github.com/acme/platform
userCli knowledge search "auth middleware" --profile contributor
userCli knowledge mcp
userCli knowledge serve
userCli knowledge --help
```

Everything after `knowledge` is the normal Atlas command tree, options, validation, JSON behavior, and exit-code behavior.

## Schema

| Field                 | Meaning                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `namespace`           | Commander command segment only. Controls `userCli knowledge ...`; not persisted Atlas identity.                                            |
| `identityRoot`        | Existing Atlas identity root. Same validation as standalone identity roots. In mounted mode this is a wrapper default, not a visible flag.  |
| `mcp.name`            | Existing MCP server identity name. Same semantics as `--atlas-mcp-name`, `ATLAS_MCP_NAME`, and config `identity.mcp.name`.                 |
| `mcp.title`           | Existing MCP server display title. Same semantics as `--atlas-mcp-title`, `ATLAS_MCP_TITLE`, and config `identity.mcp.title`.              |
| `mcp.resourcePrefix`  | Existing MCP resource and skill alias prefix. Config-only today through `identity.mcp.resourcePrefix`; no CLI flag or env variable exists. |
| `defaults.config`     | Default Atlas config path. Equivalent to `ATLAS_CONFIG` unless user passes `--config`.                                                     |
| `defaults.cacheDir`   | Default cache directory. Equivalent to `ATLAS_CACHE_DIR` when env/config do not override it.                                               |
| `defaults.logLevel`   | Default log level. Equivalent to `ATLAS_LOG_LEVEL` when env/config do not override it.                                                     |
| `defaults.caCertPath` | Default CA certificate path. Equivalent to `ATLAS_CA_CERT_PATH` when env does not override it.                                             |

Explicit user flags keep normal Atlas precedence for exposed options such as `--config`, `--cwd`, `--json`, and command-specific flags. Mounted commands intentionally hide standalone Atlas identity flags, so wrapper code should set identity defaults through `identityRoot` and `mcp` mount config.

## Mounting patterns

Use `attachAtlas` when the host CLI already has a root program and you want Atlas added as a subcommand:

```ts
const program = new Command().name("userCli");
attachAtlas(program, { namespace: "knowledge" });
program.parse();
```

Use `createAtlasCommand` when the host CLI wants to customize or conditionally register the Atlas command before adding it:

```ts
const knowledge = createAtlasCommand({
  namespace: "knowledge",
  identityRoot: ".acme/knowledge",
});

program.addCommand(knowledge, { hidden: process.env.ACME_KNOWLEDGE !== "1" });
```

The namespace must be a single Commander segment: no whitespace, `/`, or `\\`. Use `displayName` for help text if the command segment and displayed product name differ.

## Recommended enterprise flow

1. Pick a stable namespace, for example `knowledge`, `docs`, or `atlas`.
2. Pick an enterprise-owned identity root such as `.acme/knowledge` so artifacts and cache files do not collide with standalone Atlas usage.
3. Provide default config/cache paths only when the wrapper owns those locations. Users can still override them through normal Atlas flags, env vars, or config files.
4. Let users run setup through the mounted command:

```sh
userCli knowledge setup
userCli knowledge repo add github.com/acme/platform
userCli knowledge search "rate limiting" --profile public
userCli knowledge search "release pipeline" --profile contributor
userCli knowledge mcp
```

5. For maintainer checkouts, publish/update the repo-local artifact with the selected profile:

```sh
userCli knowledge init
userCli knowledge build --profile public
userCli knowledge artifact verify --fresh
```

## Metadata and profile behavior

Mounted commands use the same indexing and profile semantics as standalone Atlas:

- Discovery indexes Markdown broadly by default.
- Frontmatter/config metadata resolves `audience`, `purpose`, and `visibility` deterministically.
- Artifact export and search apply `--profile` at query/export time.
- `--profile public` is for public consumer docs.
- `--profile contributor` is for contributor-facing docs.
- `--profile maintainer` and `--profile internal` are available for more privileged workflows.

Wrappers should pass the intended `--profile` in automation instead of relying on implicit defaults for every user workflow.

## Limits

Visual branding fields are not supported: `logo`, `color`, `docsUrl`, `supportUrl`, `productName`.

Auth hooks and token callbacks are not supported. Keep credentials in existing Atlas config/env surfaces such as configured token env var names.

Atlas does not expose a broad command SDK here. `attachAtlas` mounts maintained Atlas Commander commands as-is.
