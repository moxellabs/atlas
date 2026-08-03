import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveEvalConfig } from "../retrieval-cli/config";
import { readCorpusEvidence, type CorpusEvidence } from "./corpus-snapshot";
import {
  codexAgentCommand,
  hermeticCodexEnvironment,
  hermeticCodexOptions,
  judgePrompt,
} from "./codex-command-policy";
import {
  codexAgentOutputJsonSchema,
  codexJudgeOutputJsonSchema,
  failedCodexJudgeVerdict,
  parseCodexAgentAnswer,
  parseCodexJudgeOutput,
} from "./codex-contracts";
import { snapshotGlobalCorpus } from "./codex-corpus-runtime";
import { traceMcpEvents } from "./codex-mcp-trace";
import { runCodexCommand, runCodexText } from "./codex-process-runner";
import { sanitizeEvalText } from "./sanitize";
import type { AgentEffectExecutor } from "./run";
import type {
  AgentArm,
  AgentEffectDataset,
  AgentEffectTask,
  AgentRun,
  AgentRunStatus,
  McpTraceSummary,
  PairJudgeVerdict,
} from "./types";

export interface CodexExecutorHandle {
  readonly executor: AgentEffectExecutor;
  readonly codexVersion: string;
  readonly corpusProvenance?: {
    readonly indexedRevision: string;
    readonly corpusDigest: string;
  };
  readonly close: () => Promise<void>;
}

/** Creates an ephemeral, read-only Codex runner without modifying user MCP configuration. */
export async function createCodexExecutor(input: {
  readonly cwd: string;
  readonly dataset: AgentEffectDataset;
  readonly agentCwd?: string;
  readonly useGlobal?: boolean;
  readonly snapshotGlobalCorpus?: boolean;
  readonly competitiveTools?: boolean;
}): Promise<CodexExecutorHandle> {
  const workDir = await mkdtemp(join(tmpdir(), "atlas-luna-eval-"));
  const generatedAgentCwd = input.agentCwd === undefined;
  const agentCwd =
    input.agentCwd ?? (await mkdtemp(join(tmpdir(), "atlas-consumer-eval-")));
  await mkdir(join(workDir, "home"), { recursive: true });
  if (agentCwd === input.cwd)
    throw new Error(
      "Agent-effect evaluation requires a consumer workspace separate from the indexed source checkout.",
    );
  const config =
    input.snapshotGlobalCorpus === true
      ? await snapshotGlobalCorpus({ workDir, repoId: input.dataset.repoId })
      : await resolveEvalConfig({
          cli: "bun run cli",
          useGlobal: input.useGlobal === true,
          cwd: input.cwd,
        });
  const evidenceByTask =
    "corpusDbPath" in config
      ? new Map(
          input.dataset.tasks.map((task) => [
            task.id,
            readCorpusEvidence({
              corpusPath: config.corpusDbPath,
              repoId: input.dataset.repoId,
              paths: task.criteria.flatMap(
                (criterion) => criterion.evidencePaths,
              ),
            }),
          ]),
        )
      : new Map<string, CorpusEvidence[]>();
  const agentSchemaPath = join(workDir, "agent-output.schema.json");
  const judgeSchemaPath = join(workDir, "judge-output.schema.json");
  await Promise.all([
    writeFile(
      agentSchemaPath,
      `${JSON.stringify(codexAgentOutputJsonSchema())}\n`,
    ),
    writeFile(
      judgeSchemaPath,
      `${JSON.stringify(codexJudgeOutputJsonSchema())}\n`,
    ),
  ]);
  const codexVersion = (
    await runCodexText(["codex", "--version"], input.cwd, 15_000)
  ).trim();
  if (config.configPath === undefined && input.useGlobal !== true)
    throw new Error(
      "Agent-effect treatment requires a local indexed Atlas artifact or explicit global runtime.",
    );
  return {
    codexVersion,
    ...("corpusProvenance" in config
      ? { corpusProvenance: config.corpusProvenance }
      : {}),
    executor: {
      runAgent: async ({ arm, task, trial }) =>
        runAgent({
          atlasCwd: input.cwd,
          repoId: input.dataset.repoId,
          cwd: agentCwd,
          isolateWorkspace: generatedAgentCwd,
          workDir,
          ...(config.configPath === undefined
            ? {}
            : { configPath: config.configPath }),
          useGlobal: input.useGlobal === true,
          competitiveTools: input.competitiveTools === true,
          outputSchemaPath: agentSchemaPath,
          runner: input.dataset.runner,
          arm,
          task,
          trial,
        }),
      judgePair: async ({ task, baseline, treatment, order }) =>
        judgePair({
          cwd: agentCwd,
          workDir,
          outputSchemaPath: judgeSchemaPath,
          runner: input.dataset.runner,
          task,
          baseline,
          treatment,
          order,
          evidence: evidenceByTask.get(task.id) ?? [],
        }),
    },
    close: async () => {
      await rm(workDir, { recursive: true, force: true });
      if (config.tempConfigDir !== undefined)
        await rm(config.tempConfigDir, { recursive: true, force: true });
      if (generatedAgentCwd)
        await rm(agentCwd, { recursive: true, force: true });
    },
  };
}

async function runAgent(input: {
  readonly atlasCwd: string;
  readonly repoId: string;
  readonly cwd: string;
  readonly isolateWorkspace: boolean;
  readonly workDir: string;
  readonly configPath?: string;
  readonly useGlobal: boolean;
  readonly competitiveTools: boolean;
  readonly outputSchemaPath: string;
  readonly runner: AgentEffectDataset["runner"];
  readonly arm: AgentArm;
  readonly task: AgentEffectTask;
  readonly trial: number;
}): Promise<AgentRun> {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const suffix = `${input.task.id}-${input.trial}-${input.arm}`;
  const cwd = input.isolateWorkspace ? join(input.cwd, suffix) : input.cwd;
  await mkdir(cwd, { recursive: true });
  const outputPath = join(input.workDir, `${suffix}.answer.json`);
  const result = await runCodexCommand(
    codexAgentCommand({ ...input, cwd, outputPath }),
    cwd,
    input.runner.agentTimeoutMs,
    hermeticCodexEnvironment(input.workDir),
  );
  const durationMs = Math.round(performance.now() - started);
  const trace = traceMcpEvents(result.stdout);
  if (result.timedOut)
    return failedRun(
      input,
      startedAt,
      durationMs,
      "timeout",
      "Codex exceeded the agent timeout.",
      trace,
    );
  if (result.exitCode !== 0)
    return failedRun(
      input,
      startedAt,
      durationMs,
      "error",
      result.stderr || result.stdout,
      trace,
    );
  try {
    return {
      arm: input.arm,
      taskId: input.task.id,
      trial: input.trial,
      startedAt,
      durationMs,
      status: "completed",
      answer: parseCodexAgentAnswer(await readFile(outputPath, "utf8")),
      mcp: trace,
    };
  } catch (error) {
    return failedRun(
      input,
      startedAt,
      durationMs,
      "invalid-output",
      String(error),
      trace,
    );
  }
}

async function judgePair(input: {
  readonly cwd: string;
  readonly workDir: string;
  readonly outputSchemaPath: string;
  readonly runner: AgentEffectDataset["runner"];
  readonly task: AgentEffectTask;
  readonly baseline: AgentRun;
  readonly treatment: AgentRun;
  readonly order: readonly AgentArm[];
  readonly evidence: readonly CorpusEvidence[];
}): Promise<PairJudgeVerdict> {
  const leftArm = input.order[0];
  const rightArm = input.order[1];
  const left = leftArm === "baseline" ? input.baseline : input.treatment;
  const right = rightArm === "baseline" ? input.baseline : input.treatment;
  const outputPath = join(
    input.workDir,
    `${input.task.id}-${input.baseline.trial}.judge.json`,
  );
  const result = await runCodexCommand(
    [
      "codex",
      "exec",
      "--ephemeral",
      ...hermeticCodexOptions(input.cwd),
      "-C",
      input.cwd,
      "-m",
      input.runner.model,
      "-c",
      `model_reasoning_effort=${JSON.stringify(input.runner.reasoningEffort)}`,
      "--output-schema",
      input.outputSchemaPath,
      "-o",
      outputPath,
      judgePrompt(input.task, left.answer, right.answer, input.evidence),
    ],
    input.cwd,
    input.runner.judgeTimeoutMs,
    hermeticCodexEnvironment(input.workDir),
  );
  if (result.exitCode !== 0 || result.timedOut)
    return failedCodexJudgeVerdict(
      input.task,
      result.timedOut ? "Judge timed out." : result.stderr || result.stdout,
    );
  try {
    const output = parseCodexJudgeOutput(
      await readFile(outputPath, "utf8"),
      input.task,
    );
    return leftArm === "baseline"
      ? { baseline: output.left, treatment: output.right }
      : { baseline: output.right, treatment: output.left };
  } catch (error) {
    return failedCodexJudgeVerdict(input.task, String(error));
  }
}

function failedRun(
  input: {
    readonly arm: AgentArm;
    readonly task: AgentEffectTask;
    readonly trial: number;
  },
  startedAt: string,
  durationMs: number,
  status: AgentRunStatus,
  error: string,
  mcp: McpTraceSummary,
): AgentRun {
  return {
    arm: input.arm,
    taskId: input.task.id,
    trial: input.trial,
    startedAt,
    durationMs,
    status,
    error: sanitizeEvalText(error, 1_000),
    mcp,
  };
}
