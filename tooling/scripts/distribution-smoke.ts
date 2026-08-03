import { $, file, type Subprocess } from "bun";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

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

type InstalledServerProcess = Subprocess<"ignore", "pipe", "inherit">;

function assertIncludes(
  value: string,
  expected: string,
  context: string,
): void {
  if (!value.includes(expected)) {
    throw new Error(
      `${context} missing ${JSON.stringify(expected)} from the installed bundle.`,
    );
  }
}

async function waitForServerUrl(
  child: InstalledServerProcess,
): Promise<string> {
  const decoder = new TextDecoder();
  let output = "";
  let settled = false;
  let resolveReady!: (url: string) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<string>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  void (async () => {
    try {
      for await (const chunk of child.stdout) {
        output += decoder.decode(chunk, { stream: true });
        const match = /Server listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(
          output,
        );
        if (match && !settled) {
          settled = true;
          resolveReady(match[1]!);
        }
      }
      if (!settled) {
        settled = true;
        rejectReady(
          new Error(
            `installed server exited before listening on loopback:\n${output}`,
          ),
        );
      }
    } catch (error) {
      if (!settled) {
        settled = true;
        rejectReady(
          error instanceof Error
            ? error
            : new Error(
                `failed to read installed server output: ${String(error)}`,
              ),
        );
      }
    }
  })();

  return await Promise.race([
    ready,
    sleep(10_000).then(() => {
      throw new Error(
        "installed server did not report a loopback listener within 10 seconds",
      );
    }),
  ]);
}

async function stopServer(child: InstalledServerProcess): Promise<void> {
  child.kill("SIGTERM");
  let exitCode = await Promise.race([
    child.exited,
    sleep(2_000).then(() => undefined),
  ]);
  if (exitCode === undefined) {
    child.kill("SIGKILL");
    exitCode = await child.exited;
  }
  if (exitCode !== 0) {
    throw new Error(`installed server exited with code ${exitCode}`);
  }
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  if (address === null || typeof address === "string") {
    throw new Error(
      "failed to reserve a loopback port for installed server smoke",
    );
  }
  return address.port;
}

async function assertInstalledPortConflictFails(
  cli: string,
  workspace: string,
  port: number,
): Promise<void> {
  const child = Bun.spawn(
    [cli, "serve", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: workspace,
      env: Bun.env,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const output = Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]).then((parts) => parts.join("\n"));
  const exitCode = await Promise.race([
    child.exited,
    sleep(5_000).then(() => undefined),
  ]);
  if (exitCode === undefined) {
    child.kill("SIGKILL");
    await child.exited;
    throw new Error("installed server accepted a conflicting loopback port");
  }
  if (exitCode === 0) {
    throw new Error("installed server reported success for a conflicting port");
  }
  assertIncludes(
    await output,
    "EADDRINUSE",
    "installed Node server conflict failure",
  );
}

async function assertInstalledOpenApiAssets(
  cli: string,
  workspace: string,
): Promise<void> {
  const cacheDir = join(workspace, "cache");
  await $`${cli} setup --non-interactive --cache-dir ${cacheDir} --json`
    .cwd(workspace)
    .quiet();
  const port = await reserveLoopbackPort();
  const child = Bun.spawn(
    [cli, "serve", "--host", "127.0.0.1", "--port", String(port)],
    {
      cwd: workspace,
      env: Bun.env,
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  try {
    const url = await waitForServerUrl(child);
    await assertInstalledPortConflictFails(cli, workspace, port);
    const [docsResponse, specResponse] = await Promise.all([
      fetch(`${url}/docs`),
      fetch(`${url}/openapi.json`),
    ]);
    if (!docsResponse.ok)
      throw new Error(`installed OpenAPI docs returned ${docsResponse.status}`);
    if (!specResponse.ok)
      throw new Error(`installed OpenAPI spec returned ${specResponse.status}`);

    const docs = await docsResponse.text();
    assertIncludes(docs, 'id="banded-field"', "installed OpenAPI docs");
    assertIncludes(docs, "canvas#banded-field", "installed OpenAPI docs");
    assertIncludes(
      docs,
      "prefers-reduced-motion",
      "installed OpenAPI docs animation",
    );
    assertIncludes(
      docs,
      "seedPulses",
      "installed OpenAPI docs banded-field program",
    );
    assertIncludes(
      docs,
      "moxel-test-request-button",
      "installed OpenAPI docs Scalar polish program",
    );

    const spec = (await specResponse.json()) as {
      info?: { title?: unknown };
      paths?: unknown;
    };
    if (typeof spec.info?.title !== "string" || spec.paths === undefined)
      throw new Error(
        "installed OpenAPI spec did not expose document metadata",
      );
  } finally {
    await stopServer(child);
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
    await assertInstalledOpenApiAssets(cli, workspace);

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
    `Distribution smoke passed: ${entry.filename} installs, exposes the Atlas binary and Commander subpath, serves self-contained OpenAPI docs/spec on loopback, and reconciles agent configuration.`,
  );
} finally {
  await rm(tarball, { force: true });
}
