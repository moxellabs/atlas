import { mkdtemp, rm } from "node:fs/promises";
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
  if (entry.name !== "@moxellabs/atlas") {
    throw new Error(
      `expected packed package @moxellabs/atlas, got ${entry.name}`,
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
  try {
    await $`bun init -y`.cwd(tempRoot).quiet();
    await $`bun add ${tarball}`.cwd(tempRoot).quiet();
    await $`bun node_modules/.bin/atlas --help`.cwd(tempRoot);
    await $`bun -e ${"import { attachAtlas, createAtlasCommand } from '@moxellabs/atlas/commander'; if (typeof attachAtlas !== 'function' || typeof createAtlasCommand !== 'function') throw new Error('commander subpath missing exports');"}`.cwd(
      tempRoot,
    );
    await $`bun -e ${"const pkg = require('./node_modules/@moxellabs/atlas/package.json'); if (pkg.types !== './dist/atlas.d.ts') throw new Error('root types missing'); if (!pkg.exports['./commander']?.types) throw new Error('commander export types missing');"}`.cwd(
      tempRoot,
    );
  } finally {
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
    `Distribution smoke passed: ${entry.filename} installs and exposes atlas binary plus commander subpath.`,
  );
} finally {
  await rm(tarball, { force: true });
}
