import { runMcpRetrievalEvalMain } from "../../packages/eval/src/retrieval-cli/run";

await runMcpRetrievalEvalMain({
	argv: Bun.argv.slice(2),
	env: Bun.env,
	cwd: process.cwd(),
});
/// <reference types="bun" />

import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import {
  baselineSummaryFromReport,
  buildReport,
  caseMetadata,
  evaluateExpectations,
  loadBaseline,
  loadEvalDataset,
  printTerminalSummary,
  renderHtml,
  type BaselineSummary,
  type CaseResult,
  type ReportThresholdInput,
  type RuntimeInfo,
} from "./eval-reporting";

const defaultDatasetPath = "evals/mcp-retrieval.dataset.json";
const defaultOutPath = "evals/reports/mcp-retrieval-report.json";
const defaultHtmlPath = "evals/reports/mcp-retrieval-report.html";
const defaultArtifactDbPath = ".moxel/atlas/corpus.db";
const defaultBaselinePath = "evals/baseline/mcp-retrieval-baseline.json";
const defaultTrendPath = "evals/reports/mcp-retrieval-trend.jsonl";

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
const baselinePath = resolve(args.baseline ?? defaultBaselinePath);
const baselineDisabled =
  args["no-baseline"] === "true" || args.baseline === "none";
const updateBaseline = args["update-baseline"] === "true";
const trendPath = args["trend-log"] === "none"
  ? undefined
  : resolve(args["trend-log"] ?? defaultTrendPath);
const quietEval = args.quiet === "true" || args.quiet === "";

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
  if (!quietEval) {
    process.stderr.write("\n");
    process.stderr.write(`${evalStderrDim("Inspecting corpus and repository metadata…")}\n`);
  }
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

  const progress = createEvalProgressReporter({
    quiet: quietEval,
    tty: process.stderr.isTTY === true,
  });
  progress.banner({
    datasetPath,
    caseCount: dataset.cases.length,
    outPath,
    htmlPath,
    corpusLabel:
      runtime.corpusDbPath !== undefined
        ? relPathFriendly(runtime.corpusDbPath)
        : "CLI default corpus",
    docCount: runtime.docCount ?? "unknown",
  });

  const results: CaseResult[] = [];
  const casesTotal = dataset.cases.length;
  const casesStartedAt = performance.now();
  let passSoFar = 0;
  let failSoFar = 0;

  try {
    for (let caseIndex = 0; caseIndex < casesTotal; caseIndex++) {
      const testCase = dataset.cases[caseIndex]!;
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
        retrieval: expectationResult.retrieval,
        missing: expectationResult.missing,
        topPaths,
        diagnostics,
      });
      if (expectationResult.passed) {
        passSoFar++;
      } else {
        failSoFar++;
      }
      progress.tick({
        index: caseIndex + 1,
        total: casesTotal,
        caseId: testCase.id,
        passed: expectationResult.passed,
        latencyMs,
        passSoFar,
        failSoFar,
      });
    }
  } finally {
    progress.done({
      elapsedMs: Math.round(performance.now() - casesStartedAt),
      passSoFar,
      failSoFar,
      total: casesTotal,
    });
  }

  const baseline: BaselineSummary | undefined = baselineDisabled
    ? undefined
    : await loadBaseline(baselinePath);
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
    baseline,
  );
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  await mkdir(dirname(htmlPath), { recursive: true });
  await writeFile(htmlPath, renderHtml(report));
  console.log(`Wrote ${outPath}`);
  console.log(`Wrote ${htmlPath}`);
  if (trendPath) {
    try {
      await mkdir(dirname(trendPath), { recursive: true });
      const trendEntry = {
        generatedAt: report.generatedAt,
        dataset: report.dataset,
        repoRevision: report.runtime.repoRevision,
        severity: report.narrative.severity,
        metrics: report.metrics,
      };
      await appendFile(trendPath, `${JSON.stringify(trendEntry)}\n`);
    } catch (error) {
      console.error(`Warning: failed to append trend log ${trendPath}: ${String(error)}`);
    }
  }
  if (updateBaseline) {
    const summary = baselineSummaryFromReport(report);
    await mkdir(dirname(baselinePath), { recursive: true });
    await writeFile(baselinePath, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`Wrote baseline ${baselinePath}`);
  }
  printTerminalSummary(report);
  if (report.thresholds !== undefined && !report.thresholds.passed) {
    throw new Error(
      `Eval threshold gate(s) failed: ${report.thresholds.results
        .filter((result) => !result.passed)
        .map((result) => {
          const comparator = result.direction === "lower" ? ">" : "<";
          const latency =
            result.metric === "p95LatencyMs" ||
            result.metric === "averageLatencyMs";
          const actualText = latency
            ? `${Math.round(result.actual)}ms`
            : percent(result.actual);
          const limitText = latency
            ? `${Math.round(result.limit)}ms`
            : percent(result.limit);
          return `${result.label} ${actualText} ${comparator} ${limitText}`;
        })
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
      minRecallAt1: parseOptionalRate(args["min-recall-at-1"], "min-recall-at-1"),
      minRecallAt3: parseOptionalRate(args["min-recall-at-3"], "min-recall-at-3"),
      minRecallAt5: parseOptionalRate(args["min-recall-at-5"], "min-recall-at-5"),
      minMrr: parseOptionalRate(args["min-mrr"], "min-mrr"),
      minNoResultAccuracy: parseOptionalRate(
        args["min-no-result-accuracy"],
        "min-no-result-accuracy",
      ),
      minForbiddenPathAccuracy: parseOptionalRate(
        args["min-forbidden-path-accuracy"],
        "min-forbidden-path-accuracy",
      ),
      maxP95LatencyMs: parseOptionalPositive(
        args["max-p95-latency-ms"],
        "max-p95-latency-ms",
      ),
      maxAverageLatencyMs: parseOptionalPositive(
        args["max-average-latency-ms"],
        "max-average-latency-ms",
      ),
      maxMetricRegression: parseOptionalRate(
        args["max-metric-regression"],
        "max-metric-regression",
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

function parseOptionalPositive(value: string | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`--${label} must be a non-negative number`);
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

function relPathFriendly(absolute: string): string {
  const r = relative(process.cwd(), absolute);
  if (r === "") {
    return ".";
  }
  return r.startsWith("..") || absolute === r ? absolute : r;
}

function evalStderrDim(text: string): string {
  if (
    process.stderr.isTTY !== true ||
    process.env.NO_COLOR !== undefined ||
    process.env.FORCE_COLOR === "0" ||
    process.env.TERM === "dumb"
  ) {
    return text;
  }
  return `\x1b[2m${text}\x1b[0m`;
}

function formatEvalElapsed(ms: number): string {
  if (ms < 1000) {
    return `${Math.max(0, Math.round(ms))}ms`;
  }
  const sec = Math.round(ms / 1000);
  if (sec < 60) {
    return `${sec}s`;
  }
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${m}m${String(r).padStart(2, "0")}s`;
}

function formatEvalEtaMs(etaMs: number): string {
  if (!Number.isFinite(etaMs) || etaMs <= 0) {
    return "";
  }
  const sec = Math.ceil(etaMs / 1000);
  if (sec < 60) {
    return `~${sec}s left`;
  }
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `~${m}m${String(r).padStart(2, "0")}s left`;
}

function truncateEvalId(id: string, maxChars: number): string {
  if (id.length <= maxChars) {
    return id;
  }
  if (maxChars <= 1) {
    return "…";
  }
  return `${id.slice(0, maxChars - 1)}…`;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function renderEvalProgressBar(
  done: number,
  total: number,
  width: number,
  useColor: boolean,
): string {
  if (total <= 0) {
    return "░".repeat(width);
  }
  const filled = Math.min(width, Math.max(0, Math.round((done / total) * width)));
  const track = width - filled;
  if (!useColor) {
    return `${"█".repeat(filled)}${"░".repeat(track)}`;
  }
  return `\x1b[32m${"█".repeat(filled)}\x1b[90m${"░".repeat(track)}\x1b[0m`;
}

interface EvalProgressReporterOptions {
  readonly quiet: boolean;
  readonly tty: boolean;
}

function createEvalProgressReporter(options: EvalProgressReporterOptions): {
  readonly banner: (input: {
    readonly datasetPath: string;
    readonly caseCount: number;
    readonly outPath: string;
    readonly htmlPath: string;
    readonly corpusLabel: string;
    readonly docCount: number | string;
  }) => void;
  readonly tick: (input: {
    readonly index: number;
    readonly total: number;
    readonly caseId: string;
    readonly passed: boolean;
    readonly latencyMs: number;
    readonly passSoFar: number;
    readonly failSoFar: number;
  }) => void;
  readonly done: (input: {
    readonly elapsedMs: number;
    readonly passSoFar: number;
    readonly failSoFar: number;
    readonly total: number;
  }) => void;
} {
  const useColor =
    options.tty &&
    process.env.NO_COLOR === undefined &&
    process.env.FORCE_COLOR !== "0" &&
    process.env.TERM !== "dumb";

  const dim = (text: string) =>
    useColor ? `\x1b[2m${text}\x1b[0m` : text;
  const bold = (text: string) =>
    useColor ? `\x1b[1m${text}\x1b[0m` : text;
  const green = (text: string) =>
    useColor ? `\x1b[32m${text}\x1b[0m` : text;
  const red = (text: string) =>
    useColor ? `\x1b[31m${text}\x1b[0m` : text;

  const latencies: number[] = [];
  let dirtyLine = false;
  const cols = process.stderr.columns ?? 100;

  return {
    banner(input) {
      if (options.quiet) {
        return;
      }
      const rule = "─".repeat(Math.min(44, Math.max(24, cols - 4)));
      const docLabel =
        typeof input.docCount === "number"
          ? input.docCount.toLocaleString("en-US")
          : input.docCount;
      process.stderr.write("\n");
      process.stderr.write(`${bold("Atlas retrieval eval")}\n`);
      process.stderr.write(`${dim(rule)}\n`);
      process.stderr.write(`  ${dim("Dataset")}  ${relPathFriendly(input.datasetPath)}\n`);
      process.stderr.write(`  ${dim("Cases")}    ${String(input.caseCount)}\n`);
      process.stderr.write(`  ${dim("Corpus")}   ${input.corpusLabel}\n`);
      process.stderr.write(`  ${dim("Docs")}     ${docLabel}\n`);
      process.stderr.write(`  ${dim("JSON")}     ${relPathFriendly(input.outPath)}\n`);
      process.stderr.write(`  ${dim("HTML")}     ${relPathFriendly(input.htmlPath)}\n`);
      process.stderr.write("\n");
    },

    tick(input) {
      if (options.quiet) {
        return;
      }
      latencies.push(input.latencyMs);
      const tail = latencies.slice(-12);
      const avg =
        tail.reduce((acc, ms) => acc + ms, 0) / Math.max(1, tail.length);
      const remaining = input.total - input.index;
      const etaText =
        remaining > 0 ? formatEvalEtaMs(remaining * avg) : "";
      const etaSuffix = etaText ? dim(` · ${etaText}`) : "";

      if (!options.tty) {
        const mark = input.passed ? green("✓") : red("✗");
        const w = String(input.total).length;
        const idx = String(input.index).padStart(w, " ");
        process.stderr.write(
          `  [${idx}/${input.total}] ${mark} ${input.latencyMs}ms  ${truncateEvalId(input.caseId, 72)}\n`,
        );
        return;
      }

      const barWidth = 20;
      const bar = renderEvalProgressBar(
        input.index,
        input.total,
        barWidth,
        useColor,
      );
      const failPart =
        input.failSoFar > 0
          ? red(` ${input.failSoFar} fail`)
          : dim(" 0 fail");
      const core = `${bar} ${dim(`${input.index}/${input.total}`)}  ${green(`${input.passSoFar} ok`)}${failPart}  ${dim(`${input.latencyMs}ms`)}${etaSuffix}`;
      const used = stripAnsi(core).length + 2;
      const idBudget = Math.max(8, cols - used);
      const idShown = truncateEvalId(input.caseId, idBudget);
      process.stderr.write(`\r  ${core}  ${dim(idShown)}\x1b[K`);
      dirtyLine = true;
    },

    done(input) {
      if (options.quiet) {
        return;
      }
      if (dirtyLine && options.tty) {
        process.stderr.write("\n");
      }
      dirtyLine = false;

      if (input.total === 0) {
        process.stderr.write(`${dim("  (no cases in dataset)")}\n\n`);
        return;
      }

      const parts: string[] = [
        dim("  Done"),
        bold(String(input.total)),
        dim("cases in"),
        bold(formatEvalElapsed(input.elapsedMs)),
        dim("·"),
        green(`${input.passSoFar} ok`),
      ];
      if (input.failSoFar > 0) {
        parts.push(dim("·"), red(`${input.failSoFar} failed`));
      }
      process.stderr.write(`${parts.join(" ")}\n\n`);
    },
  };
}
