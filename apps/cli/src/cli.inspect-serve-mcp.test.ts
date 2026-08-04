import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { runMcpCommandWithDependencies } from "./commands/mcp.command";
import { runServeCommandWithDependencies } from "./commands/serve.command";
import { buildCliDependencies } from "./runtime/dependencies";
import type { CliCommandContext } from "./runtime/types";
import {
  createCommandContext,
  createCliTestWorkspace,
  exists,
  removeCliTestWorkspace,
  runWithCapture,
  type CliTestWorkspace,
} from "./cli.test-helpers";

describe("atlas CLI inspect, serve, and MCP", () => {
  let workspace: CliTestWorkspace;

  beforeEach(async () => {
    workspace = await createCliTestWorkspace();
  });

  afterEach(async () => {
    await removeCliTestWorkspace(workspace);
  });

  test("inspect topology --live analyzes a checkout without config or store mutation", async () => {
    const liveRoot = join(
      workspace.rootDir,
      "github.mycorp.com/platform/live-atlas",
    );
    await mkdir(join(liveRoot, "docs", "archive"), { recursive: true });
    await mkdir(join(liveRoot, "skills", "document-codebase"), {
      recursive: true,
    });
    await mkdir(
      join(liveRoot, "apps", "cli", "docs", "skills", "add-cli-command"),
      { recursive: true },
    );
    await mkdir(
      join(
        liveRoot,
        "packages",
        "topology",
        "src",
        "classifiers",
        "docs",
        "skills",
        "change-doc-classification",
      ),
      {
        recursive: true,
      },
    );
    await writeFile(
      join(liveRoot, "package.json"),
      JSON.stringify({ name: "github.mycorp.com/platform/live-atlas" }),
    );
    await writeFile(join(liveRoot, "docs", "index.md"), "# Index\n");
    await writeFile(join(liveRoot, "docs", "archive", "old.md"), "# Old\n");
    await writeFile(
      join(liveRoot, "skills", "document-codebase", "SKILL.md"),
      "# Document Codebase\n",
    );
    await writeFile(
      join(liveRoot, "apps", "cli", "package.json"),
      JSON.stringify({ name: "@atlas/cli" }),
    );
    await writeFile(
      join(liveRoot, "apps", "cli", "docs", "index.md"),
      "# CLI\n",
    );
    await writeFile(
      join(
        liveRoot,
        "apps",
        "cli",
        "docs",
        "skills",
        "add-cli-command",
        "SKILL.md",
      ),
      "# Add CLI Command\n",
    );
    await writeFile(
      join(liveRoot, "packages", "topology", "package.json"),
      JSON.stringify({ name: "@atlas/topology" }),
    );
    await writeFile(
      join(
        liveRoot,
        "packages",
        "topology",
        "src",
        "classifiers",
        "docs",
        "index.md",
      ),
      "# Classifiers\n",
    );
    await writeFile(
      join(
        liveRoot,
        "packages",
        "topology",
        "src",
        "classifiers",
        "docs",
        "skills",
        "change-doc-classification",
        "SKILL.md",
      ),
      "# Change Doc Classification\n",
    );

    const result = await runWithCapture([
      "inspect",
      "topology",
      "--cwd",
      liveRoot,
      "--live",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({
      ok: true,
      command: "inspect",
      data: {
        source: "live",
        repo: expect.objectContaining({
          repoId: "live-atlas",
          config: "inferred",
          packageGlobs: ["apps/*", "packages/*"],
        }),
        packages: expect.arrayContaining([
          expect.objectContaining({ name: "@atlas/cli", path: "apps/cli" }),
          expect.objectContaining({
            name: "@atlas/topology",
            path: "packages/topology",
          }),
        ]),
        skills: expect.arrayContaining([
          expect.objectContaining({
            path: "skills/document-codebase/SKILL.md",
          }),
          expect.objectContaining({
            path: "apps/cli/docs/skills/add-cli-command/SKILL.md",
          }),
          expect.objectContaining({
            path: "packages/topology/src/classifiers/docs/skills/change-doc-classification/SKILL.md",
          }),
        ]),
      },
    });
    const paths = (payload.data.docs as Array<{ path: string }>).map(
      (doc) => doc.path,
    );
    expect(paths).toContain("docs/index.md");
    expect(paths).not.toContain("docs/archive/old.md");
    expect(await exists(join(liveRoot, "atlas.config.yaml"))).toBe(false);
    expect(await exists(join(liveRoot, ".moxel", "atlas", "corpus.db"))).toBe(
      false,
    );
  });

  test("inspect topology --live uses matching config rules when config exists", async () => {
    const liveRoot = join(workspace.rootDir, "configured-live");
    const liveConfigPath = join(workspace.rootDir, "live.config.yaml");
    await mkdir(join(liveRoot, "docs"), { recursive: true });
    await mkdir(join(liveRoot, "custom", "docs"), { recursive: true });
    await writeFile(
      join(liveRoot, "package.json"),
      JSON.stringify({ name: "configured-live" }),
    );
    await writeFile(
      join(liveRoot, "docs", "index.md"),
      "# Ignored By Custom Rules\n",
    );
    await writeFile(
      join(liveRoot, "custom", "docs", "guide.md"),
      "# Custom Guide\n",
    );
    await writeFile(
      liveConfigPath,
      `
version: 1
cacheDir: .cache/atlas
corpusDbPath: .cache/atlas/corpus.db
logLevel: info
server:
  transport: stdio
repos:
  - repoId: github.mycorp.com/platform/configured
    mode: local-git
    git:
      remote: file://${liveRoot}
      localPath: ${liveRoot}
      ref: HEAD
    workspace:
      rootPath: ${liveRoot}
      packageGlobs:
        - packages/*
      packageManifestFiles:
        - package.json
    topology:
      - id: custom-docs
        kind: repo-doc
        match:
          include:
            - custom/docs/**/*.md
        ownership:
          attachTo: repo
        authority: canonical
        priority: 10
`,
    );

    const result = await runWithCapture([
      "inspect",
      "topology",
      "github.mycorp.com/platform/configured",
      "--cwd",
      liveRoot,
      "--config",
      liveConfigPath,
      "--live",
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.data.repo).toMatchObject({
      repoId: "github.mycorp.com/platform/configured",
      config: "matched",
    });
    expect(payload.data.docs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "custom/docs/guide.md",
          authority: "canonical",
        }),
      ]),
    );
  });

  test("serve discovers setup config from runtime HOME without --config", async () => {
    const home = join(workspace.rootDir, "serve-home");
    const setup = await runWithCapture(
      [
        "setup",
        "--cwd",
        workspace.rootDir,
        "--cache-dir",
        join(workspace.rootDir, "serve-cache"),
        "--non-interactive",
      ],
      { HOME: home },
    );
    expect(setup.exitCode).toBe(0);

    // Serve waits for SIGINT/SIGTERM in production. Drive the injectable
    // lifecycle so the HOME config discovery path stays unit-testable.
    const deps = await buildCliDependencies({
      cwd: workspace.rootDir,
      env: { HOME: home },
    });
    try {
      const context = createCommandContext([], {
        host: "127.0.0.1",
        port: "48765",
      });
      context.env = { HOME: home };
      context.cwd = workspace.rootDir;
      const result = await runServeCommandWithDependencies(
        context,
        {
          server: {
            async start(options = {}) {
              expect(options).toMatchObject({
                host: "127.0.0.1",
                port: 48765,
              });
              return {
                host: "127.0.0.1",
                port: 48765,
                dbPath: deps.config.config.corpusDbPath,
                repoCount: deps.config.config.repos.length,
                openApiEnabled: true,
                mcpEnabled: true,
                uiEnabled: false,
                stop() {},
              };
            },
          },
          close: deps.close,
        },
        async () => {},
        async () => {},
      );
      expect(result).toMatchObject({
        ok: true,
        data: {
          dbPath: expect.stringContaining("serve-cache"),
        },
      });
    } finally {
      deps.close();
    }
  });

  test("serve reports startup metadata, open result, and closes CLI dependencies", async () => {
    const context = createCommandContext([], {
      host: "0.0.0.0",
      port: "40789",
      open: true,
    });
    const startedWith: Array<{
      host?: string | undefined;
      port?: number | undefined;
    }> = [];
    const opened: string[] = [];
    let closed = false;
    let stopped = false;
    let closeObservedStopped = false;

    const result = await runServeCommandWithDependencies(
      context,
      {
        server: {
          async start(options) {
            startedWith.push(options ?? {});
            return {
              host: options?.host ?? "127.0.0.1",
              port: options?.port ?? 3000,
              dbPath: "/tmp/atlas.db",
              repoCount: 1,
              openApiEnabled: true,
              mcpEnabled: true,
              uiEnabled: false,
              async stop() {
                await Promise.resolve();
                stopped = true;
              },
            };
          },
        },
        close() {
          closed = true;
          closeObservedStopped = stopped;
        },
      },
      async (url) => {
        opened.push(url);
      },
      async () => {},
    );

    expect(result).toMatchObject({
      ok: true,
      command: "serve",
      data: {
        url: "http://0.0.0.0:40789",
        browserLaunch: { ok: true },
      },
    });
    expect(startedWith).toEqual([{ host: "0.0.0.0", port: 40789 }]);
    expect(opened).toEqual(["http://0.0.0.0:40789"]);
    expect(closed).toBe(true);
    expect(closeObservedStopped).toBe(true);
  });

  test("mcp starts without requiring GitHub token config for public repos", async () => {
    const home = join(workspace.rootDir, "home-mcp-public");
    const mcpConfigPath = join(workspace.rootDir, "mcp-public.yaml");
    await writeFile(
      mcpConfigPath,
      `version: 1
cacheDir: ${JSON.stringify(workspace.cacheDir)}
logLevel: warn
server:
  transport: stdio
repos:
  - repoId: github.com/moxellabs/atlas
    mode: ghes-api
    github:
      baseUrl: https://api.github.com
      owner: moxellabs
      name: atlas
      ref: main
    workspace:
      packageGlobs: ["packages/*"]
      packageManifestFiles: ["package.json"]
    topology:
      - id: docs
        kind: repo-doc
        match:
          include: ["README.md", "docs/**/*.md"]
        ownership:
          attachTo: repo
        authority: canonical
        priority: 10
`,
    );

    const result = await runWithCapture(
      ["mcp", "--cwd", workspace.rootDir, "--config", mcpConfigPath],
      {
        HOME: home,
        GH_TOKEN: "",
        GITHUB_TOKEN: "",
        GHES_TOKEN: "",
        GH_ENTERPRISE_TOKEN: "",
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("token");
    expect(result.stdout).toBe("");
  });

  test("mcp connects stdio transport without writing CLI output to stdout", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let stdoutText = "";
    let stderrText = "";
    stdout.on("data", (chunk) => {
      stdoutText += chunk.toString("utf8");
    });
    stderr.on("data", (chunk) => {
      stderrText += chunk.toString("utf8");
    });
    const context: CliCommandContext = {
      positionals: [],
      options: {},
      cwd: process.cwd(),
      output: { json: false, verbose: false, quiet: false },
      stdin: new PassThrough() as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stderr as unknown as NodeJS.WriteStream,
      env: {},
    };
    const lifecycle = {
      start() {
        lifecycleStarted = true;
      },
      async close() {
        lifecycleClosed = true;
      },
    } as never;
    const transport: { onclose?: () => void } = {};
    let connectedTransport: unknown;
    let lifecycleStarted = false;
    let lifecycleClosed = false;
    let serverReceivedRefreshStateProvider = false;
    let closed = false;

    const result = await runMcpCommandWithDependencies(
      context,
      {
        db: {} as never,
        config: { env: {}, config: {} } as never,
        indexer: {} as never,
        close() {
          closed = true;
        },
      },
      {
        createServer(deps) {
          serverReceivedRefreshStateProvider =
            deps.repositoryRefreshStateProvider === lifecycle;
          return {
            tools: ["find_docs"],
            resources: ["atlas-document"],
            prompts: ["onboard_to_repo"],
            diagnostics: [],
            server: {
              onclose: undefined,
              async connect(nextTransport: unknown) {
                connectedTransport = nextTransport;
                queueMicrotask(() => transport.onclose?.());
              },
            },
          } as never;
        },
        createLifecycle() {
          return lifecycle;
        },
        createTransport(nextContext) {
          expect(nextContext.stdin).toBe(context.stdin);
          expect(nextContext.stdout).toBe(context.stdout);
          return transport as never;
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      command: "mcp",
      data: {
        transport: "stdio",
        tools: ["find_docs"],
      },
    });
    expect(connectedTransport).toBe(transport);
    expect(serverReceivedRefreshStateProvider).toBe(true);
    expect(lifecycleStarted).toBe(true);
    expect(lifecycleClosed).toBe(true);
    expect(closed).toBe(true);
    expect(stdoutText).toBe("");
    expect(stderrText).toBe("");
  });

  test("mcp identity passes mounted identity into server without stdio noise", async () => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    let receivedIdentity: unknown;
    let receivedDiscoveryPolicy: unknown;
    let receivedToolProfile: unknown;
    const transport: { onclose?: () => void } = {};
    const context: CliCommandContext = {
      positionals: [],
      options: { discoveryPolicy: "prefer-local", toolProfile: "advanced" },
      cwd: process.cwd(),
      output: { json: false, verbose: false, quiet: false },
      mcpName: "acme-knowledge",
      mcpTitle: "Acme Knowledge MCP",
      mcpResourcePrefix: "acme",
      identityRoot: ".acme/knowledge",
      stdin: new PassThrough() as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
      stderr: stderr as unknown as NodeJS.WriteStream,
      env: {},
    };
    const result = await runMcpCommandWithDependencies(
      context,
      { db: {} as never, close() {} },
      {
        createServer(_deps, identity, discoveryPolicy, toolProfile) {
          receivedIdentity = identity;
          receivedDiscoveryPolicy = discoveryPolicy;
          receivedToolProfile = toolProfile;
          return {
            tools: ["find_docs", "read_document", "plan_context", "use_skill"],
            resources: ["acme-document"],
            prompts: [],
            diagnostics: [],
            server: {
              async connect() {
                queueMicrotask(() => transport.onclose?.());
              },
            },
          } as never;
        },
        createTransport() {
          return transport as never;
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(receivedIdentity).toMatchObject({
      name: "acme-knowledge",
      title: "Acme Knowledge MCP",
      resourcePrefix: "acme",
    });
    expect(receivedDiscoveryPolicy).toBe("prefer-local");
    expect(receivedToolProfile).toBe("advanced");
  });

  test("mcp identity honors ATLAS_MCP_RESOURCE_PREFIX from loaded config env", async () => {
    let receivedIdentity: unknown;
    const transport: { onclose?: () => void } = {};
    const context: CliCommandContext = {
      positionals: [],
      options: {},
      cwd: process.cwd(),
      output: { json: false, verbose: false, quiet: false },
      stdin: new PassThrough() as unknown as NodeJS.ReadStream,
      stdout: new PassThrough() as unknown as NodeJS.WriteStream,
      stderr: new PassThrough() as unknown as NodeJS.WriteStream,
      env: {},
    };
    await runMcpCommandWithDependencies(
      context,
      {
        db: {} as never,
        config: {
          env: { ATLAS_MCP_RESOURCE_PREFIX: "acme" },
          config: { repos: [] },
        } as never,
        close() {},
      },
      {
        createServer(_deps, identity) {
          receivedIdentity = identity;
          return {
            tools: [],
            resources: ["acme-document"],
            prompts: [],
            diagnostics: [],
            server: {
              async connect() {
                queueMicrotask(() => transport.onclose?.());
              },
            },
          } as never;
        },
        createTransport() {
          return transport as never;
        },
      },
    );
    expect(receivedIdentity).toMatchObject({ resourcePrefix: "acme" });
  });

  test("mcp rejects unknown tool profiles before transport startup", async () => {
    const context: CliCommandContext = {
      positionals: [],
      options: { toolProfile: "wide" },
      cwd: process.cwd(),
      output: { json: false, verbose: false, quiet: false },
      stdin: new PassThrough() as unknown as NodeJS.ReadStream,
      stdout: new PassThrough() as unknown as NodeJS.WriteStream,
      stderr: new PassThrough() as unknown as NodeJS.WriteStream,
      env: {},
    };
    await expect(
      runMcpCommandWithDependencies(
        context,
        { db: {} as never, close() {} },
        {
          createServer() {
            throw new Error("server must not start");
          },
          createTransport() {
            throw new Error("transport must not start");
          },
        },
      ),
    ).rejects.toThrow("Invalid MCP tool profile: wide");
  });
});
