import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $, file } from "bun";

interface PackEntry {
  readonly id?: string;
  readonly name?: string;
  readonly filename?: string;
  readonly files?: Array<{ readonly path: string }>;
}

const forbiddenPackagePaths = [
  /^(?:package\/)?\.planning(?:\/|$)/,
  /^(?:package\/)?\.moxel(?:\/|$)/,
  /^(?:package\/)?docs(?:\/|$)/,
  /^(?:package\/)?\.git(?:\/|$)/,
  /^(?:package\/)?\.cache(?:\/|$)/,
  /^(?:package\/)?\.pi(?:\/|$)/,
  /^(?:package\/)?\.github(?:\/|$)/,
  /^(?:package\/)?node_modules(?:\/|$)/,
  /^(?:package\/)?tooling(?:\/|$)/,
  /^(?:package\/)?[^/].*\.test\.ts$/,
  /^(?:package\/)?[^/].*\.spec\.ts$/,
];

async function packAtlas(): Promise<PackEntry> {
  const output = await $`npm pack --json`.text();
  const jsonStart = output.indexOf("[");
  const entries = JSON.parse(
    jsonStart >= 0 ? output.slice(jsonStart) : output,
  ) as PackEntry[];
  const entry = entries[0];
  if (!entry?.filename) {
    throw new Error(`npm pack did not return a tarball filename: ${output}`);
  }
  return entry;
}

function assertPackageContents(entry: PackEntry): void {
  if (entry.name !== "@mrmendez/atlas") {
    throw new Error(
      `expected packed package @mrmendez/atlas, got ${entry.name}`,
    );
  }
  const paths = new Set(
    (entry.files ?? []).map((packedFile) => packedFile.path),
  );
  for (const required of [
    "package.json",
    "README.md",
    "LICENSE",
    "NOTICE",
    "bin/atlas",
    "dist/atlas.js",
    "dist/atlas.d.ts",
    "dist/commander.js",
    "dist/commander.d.ts",
    "dist/schema.sql",
  ]) {
    if (!paths.has(required)) {
      throw new Error(`packed package missing required file: ${required}`);
    }
  }
  for (const packedPath of paths) {
    const forbidden = forbiddenPackagePaths.find((pattern) =>
      pattern.test(packedPath),
    );
    if (forbidden) {
      throw new Error(`packed package includes forbidden path: ${packedPath}`);
    }
  }
}

async function assertBundleDoesNotShipTestkit(): Promise<void> {
  const bundle = await file("dist/atlas.js").text();
  if (
    bundle.includes("@atlas/testkit") ||
    bundle.includes("packages/testkit")
  ) {
    throw new Error("dist/atlas.js must not reference @atlas/testkit.");
  }
}

async function assertInstalledCli(tarball: string): Promise<void> {
  const tempRoot = await mkdtemp(join(tmpdir(), "atlas-distribution-smoke-"));
  const home = join(tempRoot, "home");
  const workspace = join(tempRoot, "workspace");
  const previousHome = Bun.env.HOME;
  const previousXdgConfigHome = Bun.env.XDG_CONFIG_HOME;
  try {
    await Promise.all([
      mkdir(home, { recursive: true }),
      mkdir(workspace, { recursive: true }),
    ]);
    Bun.env.HOME = home;
    Bun.env.XDG_CONFIG_HOME = join(home, ".config");
    await $`bun init -y`.cwd(tempRoot).quiet();
    await $`bun add ${tarball}`.cwd(tempRoot).quiet();
    const cli = join(tempRoot, "node_modules", ".bin", "atlas");
    await $`${cli} --help`.cwd(workspace);
    await $`bun -e ${"import { attachAtlas, createAtlasCommand } from '@mrmendez/atlas/commander'; if (typeof attachAtlas !== 'function' || typeof createAtlasCommand !== 'function') throw new Error('commander subpath missing exports');"}`.cwd(
      tempRoot,
    );
    await $`bun -e ${"const pkg = require('./node_modules/@mrmendez/atlas/package.json'); if (pkg.types !== './dist/atlas.d.ts') throw new Error('root types missing'); if (!pkg.exports['./commander']?.types) throw new Error('commander export types missing');"}`.cwd(
      tempRoot,
    );

    const listed = JSON.parse(
      await $`${cli} agent list --json`.cwd(workspace).text(),
    ) as { data?: Array<{ client?: string }> };
    for (const client of ["codex", "cursor", "aider"])
      if (!listed.data?.some((entry) => entry.client === client))
        throw new Error(`installed agent catalog is missing ${client}`);

    await $`${cli} agent install cursor --scope workspace --mode standard --json`
      .cwd(workspace)
      .quiet();
    await $`${cli} agent install cursor --scope workspace --mode prefer-local --json`
      .cwd(workspace)
      .quiet();
    const configured = (await file(
      join(workspace, ".cursor", "mcp.json"),
    ).json()) as {
      mcpServers?: {
        atlas?: { args?: string[] };
      };
    };
    if (
      !configured.mcpServers?.atlas?.args?.includes("--discovery-policy") ||
      !configured.mcpServers.atlas.args.includes("prefer-local")
    )
      throw new Error("installed CLI did not reconcile Cursor configuration");

    await $`${cli} agent remove cursor --scope workspace --json`
      .cwd(workspace)
      .quiet();
    const removed = (await file(
      join(workspace, ".cursor", "mcp.json"),
    ).json()) as {
      mcpServers?: { atlas?: unknown };
    };
    if (removed.mcpServers?.atlas !== undefined)
      throw new Error("installed CLI did not remove its Cursor configuration");
  } finally {
    if (previousHome === undefined) delete Bun.env.HOME;
    else Bun.env.HOME = previousHome;
    if (previousXdgConfigHome === undefined) delete Bun.env.XDG_CONFIG_HOME;
    else Bun.env.XDG_CONFIG_HOME = previousXdgConfigHome;
    await rm(tempRoot, { recursive: true, force: true });
  }
}

const entry = await packAtlas();
const tarball = join(process.cwd(), entry.filename!);
try {
  assertPackageContents(entry);
  if (!(await file(tarball).exists())) {
    throw new Error(`packed tarball missing on disk: ${tarball}`);
  }
  await assertBundleDoesNotShipTestkit();
  await assertInstalledCli(tarball);
  console.log(
    `Distribution smoke passed: ${entry.filename} installs, exposes the Atlas binary and Commander subpath, and reconciles agent configuration.`,
  );
} finally {
  await rm(tarball, { force: true });
}
