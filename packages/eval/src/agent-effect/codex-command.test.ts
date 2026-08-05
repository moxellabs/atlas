import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  atlasMcpServerArgs,
  atlasMcpServerName,
  codexAgentCommand,
  judgePrompt,
} from "./codex";
import {
  codexAgentOutputJsonSchema,
  codexAgentOutputSchema,
  codexJudgeOutputJsonSchema,
  codexJudgeOutputSchema,
  parseCodexAgentAnswer,
  parseCodexJudgeOutput,
} from "./codex-contracts";
import { hermeticCodexEnvironment } from "./codex-command-policy";
import { dataset } from "./agent-effect.test-fixtures";
import { runCodexCommand } from "./codex-process-runner";

const commandInput = {
  atlasCwd: "/atlas",
  repoId: dataset.repoId,
  cwd: "/consumer",
  workDir: "/tmp/eval",
  configPath: "/tmp/eval/atlas.config.json",
  useGlobal: false,
  outputSchemaPath: "/tmp/eval/output.schema.json",
  outputPath: "/tmp/eval/output.json",
  runner: dataset.runner,
  task: dataset.tasks[0]!,
  trial: 1,
} as const;

describe("Codex launcher selection", () => {
  test("uses a pre-resolved executable instead of a version-manager shim", () => {
    const command = codexAgentCommand({
      ...commandInput,
      codexExecutable: "/opt/codex/bin/codex",
      arm: "treatment",
    });

    expect(command[0]).toBe("/opt/codex/bin/codex");
  });
});

describe("Codex command policy", () => {
  test("builds an isolated treatment command without hiding Atlas in the prompt", () => {
    const command = codexAgentCommand({
      ...commandInput,
      arm: "treatment",
    });
    const prompt = command.at(-1);
    expect(command).toContain("--ignore-user-config");
    expect(command).toContain("--ignore-rules");
    expect(command).toContain("deferred_tool_world_state");
    expect(command).toContain("web_search");
    expect(command).toContain("standalone_web_search");
    expect(command).toContain("shell_tool");
    expect(command).toContain("unified_exec");
    expect(command).toContain('web_search="disabled"');
    expect(command).toContain("tools.web_search=false");
    expect(command).toContain('default_permissions="atlas_eval"');
    expect(command).toContain(
      'permissions.atlas_eval={ filesystem = { ":minimal" = "read", ":workspace_roots" = { "." = "write" } }, network = { enabled = false } }',
    );
    expect(command).toContain('shell_environment_policy.inherit="none"');
    expect(command).toContain(
      `mcp_servers.atlas_atlas.command=${JSON.stringify(process.execPath)}`,
    );
    expect(command).toContain(
      'mcp_servers.atlas_atlas.default_tools_approval_mode="writes"',
    );
    expect(command).toContain(
      'features.code_mode.direct_only_tool_namespaces=["atlas_atlas"]',
    );
    expect(command.join(" ")).not.toContain("--discovery-policy");
    expect(command).toContain("mcp_servers.atlas_atlas.required=true");
    expect(command).not.toContain("--sandbox");
    expect(prompt).toContain(dataset.tasks[0]!.prompt);
    expect(prompt).not.toContain("Use Atlas");
    expect(prompt).not.toContain("plan_context");
    expect(prompt).toContain(
      "Preserve the task's distinguishing names, paths, quoted terms, and constraints verbatim",
    );
    expect(prompt).toContain(
      "Do not add repository, scope, profile, audience, purpose, or visibility filters",
    );
    expect(prompt).toContain(
      "A successful evidence result with nextAction=answer_locally",
    );
    expect(prompt).toContain("Any tool call after that result is an error");
    const baselineCommand = codexAgentCommand({
      ...commandInput,
      arm: "baseline",
    });
    expect(
      baselineCommand.some((argument) =>
        argument.startsWith("mcp_servers.atlas_atlas."),
      ),
    ).toBe(false);
    expect(
      baselineCommand.some((argument) =>
        argument.startsWith("features.code_mode.direct_only_tool_namespaces="),
      ),
    ).toBe(false);
    expect(baselineCommand.at(-1)).toBe(prompt);
    const evidence = [
      { path: "docs/a.md", text: "AUTHORITATIVE_JUDGE_ONLY_EVIDENCE" },
    ];
    expect(
      judgePrompt(
        dataset.tasks[0]!,
        { answer: "left", citations: [] },
        { answer: "right", citations: [] },
        evidence,
      ),
    ).toContain("AUTHORITATIVE_JUDGE_ONLY_EVIDENCE");
    expect(
      judgePrompt(
        dataset.tasks[0]!,
        { answer: "left", citations: [] },
        { answer: "right", citations: [] },
        evidence,
      ),
    ).toContain("not an exclusive allowlist");
    expect(prompt).not.toContain("AUTHORITATIVE_JUDGE_ONLY_EVIDENCE");
  });

  test("exposes normal competing tools without weakening workspace isolation", () => {
    const command = codexAgentCommand({
      ...commandInput,
      competitiveTools: true,
      arm: "treatment",
    });
    expect(command).toContain("--enable");
    expect(command).toContain("deferred_tool_world_state");
    expect(command).toContain("web_search");
    expect(command).toContain('web_search="live"');
    expect(command).toContain("tools.web_search=true");
    expect(command.join(" ")).toContain(
      "--disable apps --disable plugins --disable browser_use --disable in_app_browser --disable computer_use",
    );
    expect(command).not.toContain("shell_tool");
    expect(command).not.toContain("unified_exec");
    expect(command).toContain('default_permissions="atlas_eval"');
    expect(command).toContain('shell_environment_policy.inherit="none"');
    expect(command.at(-1)).toContain(dataset.tasks[0]!.prompt);
  });

  test("preserves the exact hermetic command and process environment", () => {
    const command = codexAgentCommand({
      ...commandInput,
      arm: "treatment",
    });
    expect(command.slice(0, -1)).toEqual([
      "codex",
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--enable",
      "deferred_tool_world_state",
      "--disable",
      "web_search",
      "--disable",
      "standalone_web_search",
      "--disable",
      "apps",
      "--disable",
      "plugins",
      "--disable",
      "shell_tool",
      "--disable",
      "unified_exec",
      "--disable",
      "code_mode_host",
      "--disable",
      "browser_use",
      "--disable",
      "in_app_browser",
      "--disable",
      "computer_use",
      "-c",
      'web_search="disabled"',
      "-c",
      "tools.web_search=false",
      "-c",
      'default_permissions="atlas_eval"',
      "-c",
      'permissions.atlas_eval={ filesystem = { ":minimal" = "read", ":workspace_roots" = { "." = "write" } }, network = { enabled = false } }',
      "-c",
      'shell_environment_policy.inherit="none"',
      "-c",
      'shell_environment_policy.set={ HOME = "/consumer", GH_TOKEN = "", GITHUB_TOKEN = "", XDG_CACHE_HOME = "/consumer/.cache", XDG_CONFIG_HOME = "/consumer/.config", XDG_DATA_HOME = "/consumer/.local/share" }',
      "--json",
      "-C",
      "/consumer",
      "-m",
      dataset.runner.model,
      "-c",
      `model_reasoning_effort=${JSON.stringify(dataset.runner.reasoningEffort)}`,
      "--output-schema",
      "/tmp/eval/output.schema.json",
      "-o",
      "/tmp/eval/output.json",
      "-c",
      `mcp_servers.atlas_atlas.command=${JSON.stringify(process.execPath)}`,
      "-c",
      'mcp_servers.atlas_atlas.args=["/atlas/apps/cli/src/index.ts","--config","/tmp/eval/atlas.config.json","mcp"]',
      "-c",
      "mcp_servers.atlas_atlas.required=true",
      "-c",
      'mcp_servers.atlas_atlas.default_tools_approval_mode="writes"',
      "-c",
      'features.code_mode.direct_only_tool_namespaces=["atlas_atlas"]',
    ]);

    const home = "/tmp/eval/home";
    expect(hermeticCodexEnvironment("/tmp/eval")).toEqual({
      CODEX_HOME: Bun.env.CODEX_HOME ?? join(homedir(), ".codex"),
      GH_CONFIG_DIR: join(home, ".config", "gh"),
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
      HOME: home,
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      OPENAI_API_KEY: Bun.env.OPENAI_API_KEY ?? "",
      MISE_CACHE_DIR:
        Bun.env.MISE_CACHE_DIR ?? join(homedir(), ".cache", "mise"),
      MISE_CONFIG_DIR:
        Bun.env.MISE_CONFIG_DIR ?? join(homedir(), ".config", "mise"),
      MISE_DATA_DIR:
        Bun.env.MISE_DATA_DIR ?? join(homedir(), ".local", "share", "mise"),
      PATH: Bun.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      TZ: "UTC",
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_DATA_HOME: join(home, ".local", "share"),
    });
  });

  test("selects checkout or global Atlas MCP arguments explicitly", () => {
    expect(atlasMcpServerName("github.com/justmrmendez/diffract")).toBe(
      "atlas_diffract",
    );
    expect(
      atlasMcpServerArgs({
        atlasCwd: "/atlas",
        configPath: "/tmp/eval.json",
        useGlobal: false,
      }),
    ).toEqual([
      "/atlas/apps/cli/src/index.ts",
      "--config",
      "/tmp/eval.json",
      "mcp",
    ]);
    expect(atlasMcpServerArgs({ atlasCwd: "/atlas", useGlobal: true })).toEqual(
      ["/atlas/apps/cli/src/index.ts", "mcp"],
    );
    expect(() =>
      atlasMcpServerArgs({ atlasCwd: "/atlas", useGlobal: false }),
    ).toThrow("explicit local eval config or global runtime");
  });

  test("projects and parses canonical Codex output contracts", () => {
    const agent = {
      answer: "answer",
      citations: [{ path: "docs/a.md", claim: "proof" }],
    };
    const judge = {
      left: {
        criteria: [
          { id: "completion", passed: true, reason: "ok" },
          { id: "grounding", passed: false, reason: "missing" },
        ],
        unsupportedClaimCount: 0,
      },
      right: {
        criteria: [
          { id: "completion", passed: true, reason: "ok" },
          { id: "grounding", passed: true, reason: "ok" },
        ],
        unsupportedClaimCount: 1,
      },
    };
    expect(codexAgentOutputSchema.parse(agent)).toEqual(agent);
    expect(codexJudgeOutputSchema.parse(judge)).toEqual(judge);
    expect(codexAgentOutputJsonSchema()).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(codexJudgeOutputJsonSchema()).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(parseCodexAgentAnswer(JSON.stringify(agent))).toEqual(agent);
    expect(
      parseCodexJudgeOutput(JSON.stringify(judge), dataset.tasks[0]!),
    ).toEqual(judge);
    expect(() =>
      parseCodexAgentAnswer('{"answer":"x","citations":[{}]}'),
    ).toThrow("invalid citation");
    expect(() => parseCodexJudgeOutput("[]", dataset.tasks[0]!)).toThrow(
      "pair contract",
    );
    expect(() =>
      parseCodexJudgeOutput(
        JSON.stringify({
          ...judge,
          left: { ...judge.left, criteria: [judge.left.criteria[0]] },
        }),
        dataset.tasks[0]!,
      ),
    ).toThrow("every rubric criterion exactly once");
  });

  test("preserves nonzero process output", async () => {
    const result = await runCodexCommand(
      [process.execPath, "-e", "console.error('failure'); process.exit(7)"],
      process.cwd(),
      1_000,
    );
    expect(result).toMatchObject({
      exitCode: 7,
      timedOut: false,
      stderr: "failure\n",
    });
  });

  test("marks timed out processes after termination", async () => {
    // The runner binds the platform timer directly; a child process is the only behavioral timeout seam.
    const result = await runCodexCommand(
      [process.execPath, "-e", "setInterval(() => {}, 1_000)"],
      process.cwd(),
      10,
    );
    expect(result.timedOut).toBe(true);
  });
});
