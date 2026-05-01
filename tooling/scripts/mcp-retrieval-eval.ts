/// <reference types="bun" />

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  buildReport,
  caseMetadata,
  evaluateExpectations,
  loadEvalDataset,
  printTerminalSummary,
  renderHtml,
  type CaseResult,
  type ReportThresholdInput,
  type RuntimeInfo,
} from "./eval-reporting";

const defaultDatasetPath = "evals/mcp-retrieval.dataset.json";
const defaultOutPath = "evals/reports/mcp-retrieval-report.json";
const defaultHtmlPath = "evals/reports/mcp-retrieval-report.html";
const defaultArtifactDbPath = ".moxel/atlas/corpus.db";

const args = parseArgs(Bun.argv.slice(2));
const datasetPath = resolve(args.dataset ?? defaultDatasetPath);
const outPath = resolve(args.out ?? defaultOutPath);
const htmlPath = resolve(args.html ?? defaultHtmlPath);
const cli = args.cli ?? "bun run cli";
const modelProvider = args.modelProvider ?? Bun.env.ATLAS_EVAL_MODEL_PROVIDER;
const model = args.model ?? Bun.env.ATLAS_EVAL_MODEL;
const minDocs = parseInteger(
  args.minDocs ?? args["min-docs"] ?? "10",
  "min-docs",
);
const useGlobal = args.global === "true" || args["use-global"] === "true";
const thresholds = parseThresholds(args);

const dataset = await loadEvalDataset(datasetPath);
let tempConfigDir: string | undefined;

try {
  const config = await resolveEvalConfig({
    cli,
    ...(args.config === undefined ? {} : { explicitConfigPath: args.config }),
    useGlobal,
  });
  tempConfigDir = config.tempConfigDir;
  const cliPrefix = [
    ...splitCommand(cli),
    ...(config.configPath === undefined ? [] : ["--config", config.configPath]),
  ];
  const inspectedRuntime = await inspectRuntime({
    cliPrefix,
    cli,
    ...(config.configPath === undefined
      ? {}
      : { configPath: config.configPath }),
    source: config.source,
    ...(dataset.repoId === undefined ? {} : { repoId: dataset.repoId }),
  });
  const runtime =
    config.source === "repo-local-artifact"
      ? omitConfigPath(inspectedRuntime)
      : inspectedRuntime;
  if ((runtime.docCount ?? 0) < minDocs) {
    throw new Error(
      `Eval corpus too small for ${runtime.repoId ?? dataset.repoId ?? "dataset repo"}: ${runtime.docCount ?? 0} doc(s). ` +
        `Using ${runtime.configPath ?? "CLI default config"}${runtime.corpusDbPath ? ` (${runtime.corpusDbPath})` : ""}. ` +
        `Run with --config <path>, --global, or rebuild/import current .moxel/atlas artifacts. ` +
        `Use --min-docs 0 to bypass this guard.`,
    );
  }

  const results: CaseResult[] = [];

  for (const testCase of dataset.cases) {
    const startedAt = performance.now();
    const output = await runCliJson([
      ...cliPrefix,
      "inspect",
      "retrieval",
      "--query",
      testCase.query,
      "--json",
      ...((testCase.repoId ?? dataset.repoId)
        ? ["--repo", testCase.repoId ?? dataset.repoId ?? ""]
        : []),
    ]);
    const latencyMs = Math.round(performance.now() - startedAt);
    const data = isRecord(output.data) ? output.data : output;
    const plan = isRecord(data.plan) ? data.plan : data;
    const rankedHits = asArray(plan.rankedHits);
    const selected = asArray(plan.selected);
    const contextPacket = isRecord(plan.contextPacket)
      ? plan.contextPacket
      : {};
    const evidence = asArray(contextPacket.evidence);
    const diagnostics = asArray(plan.diagnostics);
    const allHits = [...rankedHits, ...selected, ...evidence];
    const topPaths = uniqueStrings(
      allHits
        .map((item) => getPath(item))
        .filter((path): path is string => path !== undefined),
    ).slice(0, 10);
    const textHaystack = await buildTextHaystack({
      rankedHits,
      selected,
      contextPacket,
      topPaths,
    });
    const diagnosticsHaystack = JSON.stringify(diagnostics).toLowerCase();
    const confidence =
      typeof contextPacket.confidence === "string"
        ? contextPacket.confidence
        : typeof plan.confidence === "string"
          ? plan.confidence
          : undefined;
    const expectationResult = evaluateExpectations({
      testCase,
      topPaths,
      textHaystack,
      diagnosticsHaystack,
      selectedCount: selected.length,
      rankedCount: rankedHits.length,
      ...(confidence === undefined ? {} : { confidence }),
    });
    results.push({
      id: testCase.id,
      category: testCase.category,
      query: testCase.query,
      ...caseMetadata(testCase),
      passed: expectationResult.passed,
      latencyMs,
      selectedCount: selected.length,
      rankedCount: rankedHits.length,
      ...(confidence === undefined ? {} : { confidence }),
      scores: expectationResult.scores,
      missing: expectationResult.missing,
      topPaths,
      diagnostics,
    });
  }

  const report = buildReport(
    dataset,
    results,
    {
      ...runtime,
      datasetPath,
    },
    Object.fromEntries(
      Object.entries({ provider: modelProvider, model }).filter(
        ([, value]) => value !== undefined,
      ),
    ) as { provider?: string; model?: string },
    thresholds,
  );
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  await mkdir(dirname(htmlPath), { recursive: true });
  await writeFile(htmlPath, renderHtml(report));
  console.log(`Wrote ${outPath}`);
  console.log(`Wrote ${htmlPath}`);
  printTerminalSummary(report);
  if (report.thresholds !== undefined && !report.thresholds.passed) {
    throw new Error(
      `Eval threshold gate(s) failed: ${report.thresholds.results
        .filter((result) => !result.passed)
        .map(
          (result) =>
            `${result.label} ${percent(result.actual)} < ${percent(result.minimum)}`,
        )
        .join(", ")}`,
    );
  }
} finally {
  if (tempConfigDir !== undefined) {
    await rm(tempConfigDir, { recursive: true, force: true });
  }
}

function parseArgs(values: string[]): Record<string, string | undefined> {
  const parsed: Record<string, string | undefined> = {};
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value?.startsWith("--")) {
      const next = values[index + 1];
      if (next === undefined || next.startsWith("--")) {
        parsed[value.slice(2)] = "true";
        continue;
      }
      parsed[value.slice(2)] = next;
      index += 1;
    }
  }
  return parsed;
}

function parseThresholds(args: Record<string, string | undefined>): ReportThresholdInput {
  return Object.fromEntries(
    Object.entries({
      minPassRate: parseOptionalRate(args["min-pass-rate"], "min-pass-rate"),
      minPathRecall: parseOptionalRate(args["min-path-recall"], "min-path-recall"),
      minTermRecall: parseOptionalRate(args["min-term-recall"], "min-term-recall"),
      minNonEmptyContextRate: parseOptionalRate(
        args["min-non-empty-context-rate"],
        "min-non-empty-context-rate",
      ),
    }).filter(([, value]) => value !== undefined),
  ) as ReportThresholdInput;
}

function parseOptionalRate(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`--${label} must be a number between 0 and 1`);
  }
  return parsed;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function splitCommand(command: string): string[] {
  return command.split(/\s+/).filter((part) => part.length > 0);
}

async function resolveEvalConfig(input: {
  cli: string;
  explicitConfigPath?: string;
  useGlobal: boolean;
}): Promise<{
  configPath?: string;
  tempConfigDir?: string;
  source: RuntimeInfo["source"];
}> {
  if (input.explicitConfigPath !== undefined) {
    return {
      configPath: resolve(input.explicitConfigPath),
      source: "explicit-config",
    };
  }
  if (input.useGlobal || input.cli !== "bun run cli") {
    return { source: "cli-default" };
  }
  const artifactDbPath = resolve(defaultArtifactDbPath);
  if (!(await Bun.file(artifactDbPath).exists())) {
    return { source: "cli-default" };
  }
  const tempConfigDir = await mkdtemp(join(tmpdir(), "atlas-eval-config-"));
  const configPath = join(tempConfigDir, "atlas.config.json");
  await writeFile(
    configPath,
    `${JSON.stringify(
      {
        version: 1,
        cacheDir: resolve(".moxel/atlas"),
        corpusDbPath: artifactDbPath,
        logLevel: "warn",
        server: { transport: "stdio" },
        hosts: [],
        repos: [],
      },
      null,
      2,
    )}\n`,
  );
  return { configPath, tempConfigDir, source: "repo-local-artifact" };
}

async function inspectRuntime(input: {
  cliPrefix: string[];
  cli: string;
  configPath?: string;
  source: RuntimeInfo["source"];
  repoId?: string;
}): Promise<RuntimeInfo> {
  const corpusDbPath =
    input.configPath === undefined
      ? undefined
      : await readCorpusDbPath(input.configPath);
  const info: RuntimeInfo = {
    cli: input.cli,
    ...(input.configPath === undefined ? {} : { configPath: input.configPath }),
    ...(input.repoId === undefined ? {} : { repoId: input.repoId }),
    ...(corpusDbPath === undefined ? {} : { corpusDbPath }),
    source: input.source,
  };
  if (input.repoId === undefined) {
    return info;
  }
  const output = await runCliJson([
    ...input.cliPrefix,
    "inspect",
    "repo",
    input.repoId,
    "--json",
  ]);
  const data = isRecord(output.data) ? output.data : {};
  const repo = isRecord(data.repo) ? data.repo : {};
  const manifest = isRecord(data.manifest) ? data.manifest : {};
  const docs = Array.isArray(data.docs) ? data.docs : [];
  return {
    ...info,
    ...(typeof repo.repoId === "string" ? { repoId: repo.repoId } : {}),
    ...(typeof repo.revision === "string"
      ? { repoRevision: repo.revision }
      : {}),
    ...(typeof manifest.indexedRevision === "string"
      ? { indexedRevision: manifest.indexedRevision }
      : {}),
    docCount: docs.length,
  };
}

function omitConfigPath(runtime: RuntimeInfo): RuntimeInfo {
  return Object.fromEntries(
    Object.entries(runtime).filter(([key]) => key !== "configPath"),
  ) as RuntimeInfo;
}

async function readCorpusDbPath(
  configPath: string,
): Promise<string | undefined> {
  if (!configPath.endsWith(".json")) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    if (isRecord(parsed) && typeof parsed.corpusDbPath === "string") {
      return parsed.corpusDbPath;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function runCliJson(command: string[]): Promise<Record<string, unknown>> {
  const proc = Bun.spawn(command, {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `Command failed (${exitCode}): ${command.join(" ")}\n${stderr}\n${stdout}`,
    );
  }
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Command did not emit JSON: ${command.join(" ")}\n${stdout}\n${stderr}\n${String(error)}`,
    );
  }
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

function getPath(item: Record<string, unknown>): string | undefined {
  const provenance = item.provenance;
  if (isRecord(provenance) && typeof provenance.path === "string") {
    return provenance.path;
  }
  return typeof item.path === "string" ? item.path : undefined;
}

async function buildTextHaystack(input: {
  rankedHits: Record<string, unknown>[];
  selected: Record<string, unknown>[];
  contextPacket: Record<string, unknown>;
  topPaths: string[];
}): Promise<string> {
  const localContents = await Promise.all(
    input.topPaths.map(async (path) => {
      const resolved = resolve(path);
      if (!(await Bun.file(resolved).exists())) {
        return "";
      }
      try {
        return await readFile(resolved, "utf8");
      } catch {
        return "";
      }
    }),
  );
  return JSON.stringify({
    rankedHits: input.rankedHits,
    selected: input.selected,
    contextPacket: input.contextPacket,
    localContents,
  }).toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function parseInteger(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer.`);
  }
  return parsed;
}
