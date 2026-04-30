#!/usr/bin/env node

const isGlobalInstall =
  process.env.npm_config_global === "true" ||
  process.env.npm_config_location === "global";

if (!isGlobalInstall) {
  process.exit(0);
}

const message = String.raw`

Atlas installed ✓

Atlas is a local-first knowledge layer for engineering docs: it imports published
repo documentation bundles, builds/searches a local corpus, and exposes that
knowledge through CLI, HTTP, and MCP.

Next steps:
  atlas setup
  atlas repo add <owner>/<repo>
  atlas search "how do I configure the MCP server?"
  atlas mcp

Wrap Atlas inside an existing Commander CLI:
  import { attachAtlas } from "@moxellabs/atlas/commander";

Docs:
  https://github.com/moxellabs/atlas#readme

`;

console.log(message);
