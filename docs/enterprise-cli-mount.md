---
title: Enterprise CLI Mount
description: Mount Atlas commands under an existing Commander CLI namespace.
audience: [consumer, maintainer]
purpose: [guide, reference]
visibility: public
order: 55
---

# Enterprise CLI Mount

Enterprise CLIs can mount Atlas under existing Commander namespaces without rebuilding Atlas commands through an SDK.

## One-minute setup

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
userCli acme repo add
userCli acme search "auth middleware"
userCli acme mcp
userCli acme serve
userCli acme --help
```

Everything after `acme` is the normal Atlas command tree, options, validation, JSON behavior, and exit-code behavior.

## Schema

| Field                 | Meaning                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `namespace`           | Commander command segment only. Controls `userCli acme ...`; not persisted Atlas identity.                                                 |
| `identityRoot`        | Existing Atlas identity root. Same validation and semantics as `--atlas-identity-root`, `ATLAS_IDENTITY_ROOT`, and config `identity.root`. |
| `mcp.name`            | Existing MCP server identity name. Same semantics as `--atlas-mcp-name`, `ATLAS_MCP_NAME`, and config `identity.mcp.name`.                 |
| `mcp.title`           | Existing MCP server display title. Same semantics as `--atlas-mcp-title`, `ATLAS_MCP_TITLE`, and config `identity.mcp.title`.              |
| `mcp.resourcePrefix`  | Existing MCP resource and skill alias prefix. Config-only today through `identity.mcp.resourcePrefix`; no CLI flag or env variable exists. |
| `defaults.config`     | Default Atlas config path. Equivalent to `ATLAS_CONFIG` unless user passes `--config`.                                                     |
| `defaults.cacheDir`   | Default cache directory. Equivalent to `ATLAS_CACHE_DIR` when env/config do not override it.                                               |
| `defaults.logLevel`   | Default log level. Equivalent to `ATLAS_LOG_LEVEL` when env/config do not override it.                                                     |
| `defaults.caCertPath` | Default CA certificate path. Equivalent to `ATLAS_CA_CERT_PATH` when env does not override it.                                             |

Explicit user flags keep normal Atlas precedence. Example: `userCli acme --atlas-identity-root .override search q` overrides wrapper `identityRoot`.

## Limits

Visual branding fields are not supported: `logo`, `color`, `docsUrl`, `supportUrl`, `productName`.

Auth hooks and token callbacks are not supported. Keep credentials in existing Atlas config/env surfaces such as configured token env var names.

Atlas does not expose a broad command SDK here. `attachAtlas` mounts maintained Atlas Commander commands as-is.
