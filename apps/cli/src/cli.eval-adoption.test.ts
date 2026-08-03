import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cliMcpAdoptionDataset } from "./cli.eval-test-helpers";
import {
  createCliTestWorkspace,
  removeCliTestWorkspace,
  runWithCapture,
  type CliTestWorkspace,
} from "./cli.test-helpers";

describe("atlas CLI eval and adoption", () => {
  let workspace: CliTestWorkspace;

  beforeEach(async () => {
    workspace = await createCliTestWorkspace();
  });

  afterEach(async () => {
    await removeCliTestWorkspace(workspace);
  });

  test("eval runs MCP adoption JSON success", async () => {
    const datasetPath = join(workspace.rootDir, "mcp-adoption.dataset.json");
    const tracePath = join(workspace.rootDir, "mcp-adoption.trace.json");
    await writeFile(datasetPath, JSON.stringify(cliMcpAdoptionDataset()));
    await writeFile(
      tracePath,
      JSON.stringify({
        cases: {
          indexed: [
            { kind: "read_resource", uri: "atlas://manifest" },
            { kind: "call_tool", name: "plan_context" },
          ],
          generic: [],
        },
      }),
    );

    const result = await runWithCapture([
      "eval",
      "--kind",
      "mcp-adoption",
      "--dataset",
      datasetPath,
      "--trace",
      tracePath,
      "--json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "eval",
      data: {
        dataset: "cli-mcp-adoption",
        passedCases: 2,
        failedCases: 0,
        adoptionScore: 1,
      },
    });
  });

  test("eval returns failure for MCP adoption misses", async () => {
    const datasetPath = join(workspace.rootDir, "mcp-adoption.dataset.json");
    const tracePath = join(workspace.rootDir, "mcp-adoption.trace.json");
    await writeFile(datasetPath, JSON.stringify(cliMcpAdoptionDataset()));
    await writeFile(
      tracePath,
      JSON.stringify({
        cases: {
          indexed: [],
          generic: [{ kind: "call_tool", name: "plan_context" }],
        },
      }),
    );

    const result = await runWithCapture([
      "eval",
      "--kind",
      "mcp-adoption",
      "--dataset",
      datasetPath,
      "--trace",
      tracePath,
      "--json",
    ]);

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: true,
      command: "eval",
      data: {
        failedCases: expect.any(Number),
      },
      exitCode: 1,
    });
    expect(JSON.parse(result.stdout).data.failedCases).toBeGreaterThan(0);
  });

  test("eval rejects invalid MCP adoption trace kind", async () => {
    const datasetPath = join(workspace.rootDir, "mcp-adoption.dataset.json");
    const tracePath = join(workspace.rootDir, "mcp-adoption.trace.json");
    await writeFile(datasetPath, JSON.stringify(cliMcpAdoptionDataset()));
    await writeFile(
      tracePath,
      JSON.stringify({
        cases: {
          indexed: [{ kind: "fetch_remote", uri: "https://example.com" }],
        },
      }),
    );

    const result = await runWithCapture([
      "eval",
      "--kind",
      "mcp-adoption",
      "--dataset",
      datasetPath,
      "--trace",
      tracePath,
      "--json",
    ]);

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      command: "eval",
      error: { code: "CLI_INVALID_EVAL_TRACE" },
      exitCode: 2,
    });
  });

  test("adoption template command renders human and JSON contracts", async () => {
    const human = await runWithCapture([
      "adoption-template",
      "moxellabs/atlas",
      "--repo-id",
      "github.com/moxellabs/atlas",
    ]);
    expect(human.exitCode).toBe(0);
    for (const text of [
      "## Optional maintainer steps",
      "## Issue draft",
      "## PR draft",
      "atlas init",
      "atlas build",
      "git add .moxel/atlas",
      "manifest.json",
      "corpus.db",
      "checksums.json",
      "docs.index.json",
      "Would you consider publishing an Atlas docs bundle",
      "This is a request from a user of this repository, not an automated Atlas action.",
      "Atlas does not branch, commit, push, create issues, or create PRs.",
    ])
      expect(human.stdout).toContain(text);

    const json = await runWithCapture([
      "adoption-template",
      "moxellabs/atlas",
      "--repo-id",
      "github.com/moxellabs/atlas",
      "--json",
    ]);
    const parsed = JSON.parse(json.stdout);
    expect(parsed.data.adoptionTemplates.issueTemplate).toContain("atlas init");
    expect(parsed.data.adoptionTemplates.prTemplate).toContain(
      "git add .moxel/atlas",
    );
    expect(parsed.data.adoptionTemplates.commands).toEqual([
      "atlas init",
      "atlas build",
      "git add .moxel/atlas",
    ]);
  });

  test("adoption template filters and non-interactive repo id boundary", async () => {
    const issue = await runWithCapture([
      "adoption-template",
      "moxellabs/atlas",
      "--repo-id",
      "github.com/moxellabs/atlas",
      "--issue-only",
    ]);
    expect(issue.stdout).toContain("## Issue draft");
    expect(issue.stdout).not.toContain("## PR draft");
    const pr = await runWithCapture([
      "adoption-template",
      "moxellabs/atlas",
      "--repo-id",
      "github.com/moxellabs/atlas",
      "--pr-only",
    ]);
    expect(pr.stdout).toContain("## PR draft");
    expect(pr.stdout).not.toContain("## Issue draft");
    const maintainer = await runWithCapture([
      "adoption-template",
      "moxellabs/atlas",
      "--repo-id",
      "github.com/moxellabs/atlas",
      "--maintainer-only",
    ]);
    expect(maintainer.stdout).toContain("## Optional maintainer steps");
    expect(maintainer.stdout).not.toContain("## Issue draft");
    const repoIdOnly = await runWithCapture([
      "adoption-template",
      "--repo-id",
      "github.com/moxellabs/atlas",
      "--non-interactive",
      "--json",
    ]);
    expect(repoIdOnly.exitCode).toBe(0);
    expect(JSON.parse(repoIdOnly.stdout).data.repoId).toBe(
      "github.com/moxellabs/atlas",
    );
    const error = await runWithCapture([
      "adoption-template",
      "--non-interactive",
    ]);
    expect(error.exitCode).toBe(2);
    expect(error.stderr).toContain(
      "Repository input or --repo-id is required.",
    );
  });

  test("adoption documentation contains required wording and avoids forbidden automation", async () => {
    const docs = await Promise.all(
      [
        "README.md",
        "docs/ingestion-build-flow.md",
        "docs/security.md",
        "docs/runtime-surfaces.md",
        "apps/cli/docs/index.md",
      ].map((path) => readFile(path, "utf8")),
    );
    const combined = docs.join("\n");
    for (const required of [
      "atlas repo add org/repo --maintainer-instructions",
      "atlas repo add org/repo --issue-pr-instructions",
      "atlas adoption-template org/repo --repo-id github.com/org/repo",
      "Maintainers control branch names, commit messages, hooks, PR templates, and permissions.",
      "Atlas does not branch, commit, push, create issues, or create PRs.",
    ])
      expect(combined).toContain(required);
    for (const forbidden of [
      "git push --force",
      "--no-verify",
      "disable branch protection",
      "skip required reviews",
      "create pull request automatically",
      "create issue automatically",
    ])
      expect(combined).not.toContain(forbidden);
  });
});
