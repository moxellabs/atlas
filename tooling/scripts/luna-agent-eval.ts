/// <reference types="bun" />

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  agentEffectDatasetDigest,
  assertAgentToolRouting,
  assertHermeticAtlasDiscovery,
  createCodexExecutor,
  loadAgentEffectDataset,
  runAgentEffectEvaluation,
  writeAgentEffectSnapshot,
} from "../../packages/eval/src/agent-effect";

const args = parseArgs(Bun.argv.slice(2));
const cwd = process.cwd();
const datasetPath = resolve(
  cwd,
  args.dataset ?? "evals/datasets/luna-agent-effect.json",
);
const releaseId = args["release-id"];
const outputPath = resolve(
  cwd,
  args.out ?? "/tmp/atlas-luna-eval/luna-agent-effect.json",
);
const taskId = args.task;
const trialCount = positiveInteger(args.trials, "--trials");
const requireAtlasAdoption = args["require-atlas-adoption"] === "true";
const requireToolRouting = args["require-tool-routing"] === "true";
const agentCwd =
  args.workspace === undefined ? undefined : resolve(cwd, args.workspace);
const useGlobal = args.global === "true";
const snapshotGlobalCorpus = args["snapshot-global-corpus"] === "true";
const competitiveTools = args["competitive-tools"] === "true";

if (useGlobal && snapshotGlobalCorpus) {
  throw new Error(
    "--global and --snapshot-global-corpus are mutually exclusive.",
  );
}
if (requireAtlasAdoption && (!snapshotGlobalCorpus || agentCwd !== undefined)) {
  throw new Error(
    "Atlas adoption gates require --snapshot-global-corpus and an evaluator-generated empty workspace.",
  );
}
if (requireAtlasAdoption && trialCount !== undefined && trialCount < 3) {
  throw new Error("Atlas adoption gates require at least three trials.");
}
if (
  requireToolRouting &&
  (!snapshotGlobalCorpus || agentCwd !== undefined || !competitiveTools)
) {
  throw new Error(
    "Agent routing gates require --snapshot-global-corpus, --competitive-tools, and an evaluator-generated empty workspace.",
  );
}

if (Bun.env.CI !== undefined && Bun.env.CI !== "") {
  throw new Error(
    "Luna agent evaluation is local-only and must not run in CI.",
  );
}
if (
  releaseId !== undefined &&
  (taskId !== undefined ||
    trialCount !== undefined ||
    requireAtlasAdoption ||
    requireToolRouting)
) {
  throw new Error(
    "Release Luna snapshots must run the complete standard suite without smoke-test overrides.",
  );
}
if (releaseId !== undefined && !(await hasCleanTrackedWorktree(cwd))) {
  throw new Error(
    "Release Luna snapshots require committed source changes. Commit or stash tracked changes, then run the benchmark before adding its history-only snapshot commit.",
  );
}
if (
  (requireAtlasAdoption || requireToolRouting) &&
  !(await hasCleanTrackedWorktree(cwd))
) {
  throw new Error(
    "Atlas adoption and routing gates require committed source changes so evaluatedRevision identifies the exact implementation under test.",
  );
}

const loadedDataset = await loadAgentEffectDataset(datasetPath);
const tasks =
  taskId === undefined
    ? loadedDataset.tasks
    : loadedDataset.tasks.filter((task) => task.id === taskId);
if (tasks.length === 0) {
  throw new Error(`Unknown Luna task: ${taskId}`);
}
const dataset = {
  ...loadedDataset,
  ...(trialCount === undefined
    ? {}
    : { runner: { ...loadedDataset.runner, trialsPerTask: trialCount } }),
  tasks,
};
const datasetDigest = agentEffectDatasetDigest(dataset);
const handle = await createCodexExecutor({
  cwd,
  dataset,
  ...(agentCwd === undefined ? {} : { agentCwd }),
  ...(useGlobal ? { useGlobal: true } : {}),
  ...(snapshotGlobalCorpus ? { snapshotGlobalCorpus: true } : {}),
  ...(competitiveTools ? { competitiveTools: true } : {}),
});
const corpusProvenance =
  handle.corpusProvenance ??
  (useGlobal
    ? {}
    : {
        ...(await readIndexedRevision(cwd)),
        ...(await readCorpusDigest(cwd)),
      });
try {
  const snapshot = await runAgentEffectEvaluation({
    dataset,
    releaseId: releaseId ?? "local",
    datasetDigest,
    provenance: {
      evaluatedRevision: await git(cwd, ["rev-parse", "HEAD"]),
      ...corpusProvenance,
      codexVersion: handle.codexVersion,
    },
    executor: handle.executor,
  });
  if (releaseId !== undefined) {
    const written = await writeAgentEffectSnapshot({ cwd, snapshot });
    console.log(`Wrote release Luna snapshot ${written}`);
  } else {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`Wrote local Luna result ${outputPath}`);
  }
  if (requireAtlasAdoption) assertHermeticAtlasDiscovery(snapshot);
  if (requireToolRouting) assertAgentToolRouting(dataset, snapshot);
  console.log(
    `Luna paired results: ${snapshot.metrics.paired.wins} treatment wins, ${snapshot.metrics.paired.ties} ties, ${snapshot.metrics.paired.losses} treatment losses across ${snapshot.metrics.pairs} pairs.`,
  );
} finally {
  await handle.close();
}

async function readIndexedRevision(
  cwd: string,
): Promise<{ indexedRevision?: string }> {
  try {
    const artifact = JSON.parse(
      await readFile(resolve(cwd, ".moxel/atlas/manifest.json"), "utf8"),
    ) as unknown;
    if (isRecord(artifact) && typeof artifact.indexedRevision === "string")
      return { indexedRevision: artifact.indexedRevision };
  } catch {
    // The runner will still report the evaluated source revision when a manifest is absent.
  }
  return {};
}

async function readCorpusDigest(
  cwd: string,
): Promise<{ corpusDigest?: string }> {
  try {
    const contents = await readFile(
      resolve(cwd, ".moxel/atlas/checksums.json"),
    );
    return {
      corpusDigest: createHash("sha256").update(contents).digest("hex"),
    };
  } catch {
    return {};
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const process = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  return stdout.trim();
}

async function hasCleanTrackedWorktree(cwd: string): Promise<boolean> {
  const checks = [
    ["diff", "--quiet"],
    ["diff", "--cached", "--quiet"],
  ];
  for (const args of checks) {
    const process = Bun.spawn(["git", ...args], {
      cwd,
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await process.exited) !== 0) return false;
  }
  return true;
}

function parseArgs(values: string[]): Record<string, string | undefined> {
  const parsed: Record<string, string | undefined> = {};
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (!value?.startsWith("--")) continue;
    const next = values[index + 1];
    if (next === undefined || next.startsWith("--")) {
      parsed[value.slice(2)] = "true";
      continue;
    }
    parsed[value.slice(2)] = next;
    index++;
  }
  return parsed;
}

function positiveInteger(
  value: string | undefined,
  option: string,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${option} must be a positive integer.`);
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
