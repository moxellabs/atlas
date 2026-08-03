import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import packageJson from "../../../package.json" with { type: "json" };
import { join } from "node:path";
import { Command } from "commander";
import {
  type AtlasMountConfig,
  attachAtlas,
  createAtlasCommand,
} from "./commander";
import { buildFailureLines } from "./commands/reports";
import {
  collectCommandPositionals,
  shouldStartFirstRunOnboarding,
} from "./index";
import { CliError, toFailureResult } from "./utils/errors";
import {
  createCommandContext,
  createCliTestWorkspace,
  removeCliTestWorkspace,
  runWithCapture,
  type CliTestWorkspace,
} from "./cli.test-helpers";

describe("atlas CLI program and help", () => {
  let workspace: CliTestWorkspace;

  beforeEach(async () => {
    workspace = await createCliTestWorkspace();
  });

  afterEach(async () => {
    await removeCliTestWorkspace(workspace);
  });

  test("starts onboarding only for an interactive bare first run", async () => {
    const home = join(workspace.rootDir, "home-first-run");
    const context = createCommandContext([]);
    context.cwd = workspace.rootDir;
    context.output = { json: false, verbose: false, quiet: false };
    context.env = { HOME: home };
    Object.assign(context.stdin, { isTTY: true });
    Object.assign(context.stdout, { isTTY: true });

    expect(await shouldStartFirstRunOnboarding(context)).toBe(true);

    await runWithCapture(
      ["setup", "--cwd", workspace.rootDir, "--non-interactive"],
      {
        HOME: home,
      },
    );
    expect(await shouldStartFirstRunOnboarding(context)).toBe(false);

    context.output = { json: true, verbose: false, quiet: false };
    expect(await shouldStartFirstRunOnboarding(context)).toBe(false);
  });

  test("CLI_BUILD_FAILED diagnostics keep stacks verbose-only and render cause chain", () => {
    const report = {
      repoId: "github.mycorp.com/platform/docs",
      strategy: "full",
      docsRebuilt: 0,
      docsDeleted: 0,
      diagnostics: [
        {
          severity: "error",
          stage: "compile",
          path: "packages/auth/docs/api.md",
          message: "Failed to rebuild doc packages/auth/docs/api.md.",
          code: "IndexerBuildError",
          cause: {
            name: "IndexerBuildError",
            message: "Failed to rebuild docs.",
            stack: "IndexerBuildError: redacted stack",
            context: {
              operation: "rebuildDocs",
              repoId: "github.mycorp.com/platform/docs",
              entity: "packages/auth/docs/api.md",
            },
            cause: {
              name: "CompilerError",
              message: "Nested compiler failure",
              stack: "CompilerError: redacted stack",
            },
          },
        },
      ],
    };
    const error = new CliError("build failed", {
      code: "CLI_BUILD_FAILED",
      exitCode: 1,
      details: report,
    });

    expect(
      JSON.stringify(toFailureResult("build", error, false)),
    ).not.toContain("stack");
    expect(JSON.stringify(toFailureResult("build", error, true))).toContain(
      "CompilerError: redacted stack",
    );
    expect(buildFailureLines(report, false)).toContain(
      "Run again with --verbose --json to see nested cause details.",
    );
    expect(buildFailureLines(report, true).join("\n")).toContain(
      "CompilerError: Nested compiler failure",
    );
    expect(buildFailureLines(report, true).join("\n")).toContain(
      "path: packages/auth/docs/api.md",
    );
  });

  test("mounted Commander API validates namespace and returns parent", () => {
    const program = new Command();
    program.name("userCli");
    expect(attachAtlas(program, { namespace: "acme" })).toBe(program);
    expect(createAtlasCommand({ namespace: "acme" }).name()).toBe("acme");
    expect(() => createAtlasCommand({ namespace: "" })).toThrow(
      "namespace must not be empty",
    );
    expect(() => createAtlasCommand({ namespace: "acme corp" })).toThrow(
      "namespace must be a single command segment",
    );
  });

  test("mounted Commander API does not leak Atlas identity in help", () => {
    const command = createAtlasCommand({
      namespace: "knowledge",
      identityRoot: ".acme/knowledge",
      mcp: {
        name: "acme-mcp",
        title: "Acme Local Knowledge MCP",
        resourcePrefix: "acme",
      },
      defaults: { config: "./acme-knowledge.yaml" },
    });

    const rootHelp = command.helpInformation();
    const subcommandHelp = command.commands
      .map((subcommand) => subcommand.helpInformation())
      .join("\n");
    const allHelp = `${rootHelp}\n${subcommandHelp}`;

    expect(rootHelp).toContain("Usage: knowledge");
    expect(allHelp).not.toMatch(/\bAtlas\b|\batlas\b|--atlas-/);
  });

  test("mount defaults validate supported identity fields only", () => {
    const command = createAtlasCommand({
      namespace: "acme",
      identityRoot: ".acme/knowledge",
      mcp: {
        name: "acme-mcp",
        title: "Acme Local Knowledge MCP",
        resourcePrefix: "acme",
      },
      defaults: {
        config: "./acme-atlas.yaml",
        cacheDir: "~/.acme/knowledge",
        logLevel: "debug",
        caCertPath: "./ca.pem",
      },
    });
    expect(command.name()).toBe("acme");
    expect(() =>
      createAtlasCommand({
        namespace: "acme",
        mcp: { resourcePrefix: "Acme" },
      }),
    ).toThrow("identity.mcp.resourcePrefix must be a lower-kebab identifier");
  });

  test("Commander positionals are not duplicated and excess args stay visible", () => {
    expect(collectCommandPositionals(["docs"], ["docs"])).toEqual(["docs"]);
    expect(collectCommandPositionals(["docs"], ["docs", "extra"])).toEqual([
      "docs",
      "extra",
    ]);
    expect(collectCommandPositionals(["show", "docs"], ["docs"])).toEqual([
      "show",
      "docs",
    ]);
  });

  test("Commander preserves equals syntax repeated options and nested positionals", () => {
    const program = createAtlasCommand({ namespace: "knowledge" });
    const search = program.commands.find(
      (command) => command.name() === "search",
    );
    if (search === undefined) throw new Error("search command not registered");
    const searchArgs = search.parseOptions([
      "wallet",
      "--audience=consumer",
      "--audience",
      "maintainer",
      "--profile=internal",
      "--json",
    ]);
    expect(searchArgs.operands).toEqual(["wallet"]);
    expect(search.opts()).toMatchObject({
      audience: ["consumer", "maintainer"],
      profile: "internal",
      json: true,
    });

    const repo = program.commands.find((command) => command.name() === "repo");
    const show = repo?.commands.find((command) => command.name() === "show");
    if (show === undefined) throw new Error("repo show command not registered");
    const showArgs = show.parseOptions([
      "docs",
      "--cwd=/tmp/worktree",
      "--verbose",
    ]);
    expect(showArgs.operands).toEqual(["docs"]);
    expect(show.opts()).toMatchObject({
      cwd: "/tmp/worktree",
      verbose: true,
    });
  });

  test("unsupported mount fields are rejected by AtlasMountConfig typing", () => {
    // @ts-expect-error logo is not supported
    const invalid = { namespace: "acme", logo: "x" } satisfies AtlasMountConfig;
    expect(invalid.namespace).toBe("acme");
  });

  test("global options work before nested subcommands", async () => {
    const result = await runWithCapture([
      "--json",
      "list",
      "repos",
      `--config=${join(workspace.rootDir, "missing.yaml")}`,
    ]);
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      command: "list",
      error: { code: "ATLAS_CONFIG_NOT_FOUND" },
    });
  });

  test("help explains command order and setup hides wrapper-only identity knobs", async () => {
    const help = await runWithCapture(["--help"]);
    expect(help.stdout).toContain(
      "atlas setup                 one-time local runtime setup",
    );
    expect(help.stdout).toContain(
      "atlas repo add <repo>       use an existing repo artifact",
    );
    expect(help.stdout).toContain(
      "atlas init && atlas build   publish/update artifact from a checkout",
    );
    expect(help.stdout).toContain(
      "atlas index <path>          fallback local-only index",
    );
    expect(help.stdout).toContain("Start: setup, next");

    const setupHelp = await runWithCapture(["setup", "--help"]);
    const lower = setupHelp.stdout.toLowerCase();
    for (const forbidden of [
      "branding",
      "logo",
      "color",
      "productname",
      "namespace",
      "mcp title",
      "resource prefix",
      "--atlas-mcp-name",
      "--atlas-mcp-title",
    ]) {
      expect(lower).not.toContain(forbidden);
    }
  });

  test("prints the package version with short and long version flags", async () => {
    for (const flag of ["-v", "--version"]) {
      const result = await runWithCapture([flag]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe(packageJson.version);
      expect(result.stderr).toBe("");
    }
  });

  test("help lists every dispatched command", async () => {
    const result = await runWithCapture(["help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("atlas <command>");
    expect(result.stdout).toContain("Commands:");
    expect(result.stdout).toContain(".moxel/atlas");
    for (const command of [
      "setup",
      "next",
      "init",
      "repo",
      "sync",
      "build",
      "index",
      "serve",
      "mcp",
      "inspect",
      "install-skill",
      "list",
      "hosts",
      "search",
      "artifact",
      "clean",
      "prune",
      "doctor",
      "eval",
    ]) {
      expect(result.stdout).toContain(`  ${command}`);
    }
    expect(result.stdout).not.toContain("  add-repo");
  });

  test("search help explains default profile filter", async () => {
    const result = await runWithCapture(["search", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--profile <profile>");
    expect(result.stdout).toContain("defaults to public");
    expect(result.stdout).toContain("--all-profiles");
  });

  test("unknown commands return one Atlas error and print help in human mode", async () => {
    const result = await runWithCapture(["wat"]);

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown command: wat.");
    expect(result.stderr).not.toContain("error: unknown command");
    expect(result.stdout).toContain("atlas <command>");
    expect(result.stdout).toContain("Commands:");
    expect(result.stdout).toContain("  mcp");
  });

  test("repo doctor help is command-specific", async () => {
    const result = await runWithCapture(["repo", "doctor", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: atlas repo doctor");
    expect(result.stdout).toContain("[repo]");
  });

  test("local-only index help lists fallback command", async () => {
    const result = await runWithCapture(["help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "index [options] <repo>                 Clone and index a repo locally only",
    );
  });
});
