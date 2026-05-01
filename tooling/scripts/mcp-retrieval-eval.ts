import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface EvalDataset {
  name: string;
  description?: string;
  repoId?: string;
  cases: EvalCase[];
}

interface EvalCase {
  id: string;
  category: string;
  query: string;
  repoId?: string;
  expected: {
    pathIncludes?: string[];
    terms?: string[];
    tools?: string[];
  };
}

interface CaseResult {
  id: string;
  category: string;
  query: string;
  passed: boolean;
  latencyMs: number;
  selectedCount: number;
  rankedCount: number;
  confidence?: string;
  scores: {
    pathRecall: number;
    termRecall: number;
    nonEmptyContext: boolean;
  };
  missing: {
    pathIncludes: string[];
    terms: string[];
  };
  topPaths: string[];
  diagnostics: unknown[];
}

interface Report {
  dataset: string;
  description?: string;
  generatedAt: string;
  repoId?: string;
  modelJudge: {
    enabled: boolean;
    provider?: string;
    model?: string;
    note: string;
  };
  researchNotes: string[];
  totalCases: number;
  passedCases: number;
  failedCases: number;
  metrics: {
    passRate: number;
    pathRecall: number;
    termRecall: number;
    nonEmptyContextRate: number;
    averageLatencyMs: number;
    averageRankedHits: number;
  };
  byCategory: Record<
    string,
    {
      total: number;
      passed: number;
      pathRecall: number;
      termRecall: number;
      averageLatencyMs: number;
    }
  >;
  cases: CaseResult[];
}

const defaultDatasetPath = "evals/mcp-retrieval.dataset.json";
const defaultOutPath = "evals/reports/mcp-retrieval-report.json";
const defaultHtmlPath = "evals/reports/mcp-retrieval-report.html";

const args = parseArgs(Bun.argv.slice(2));
const datasetPath = resolve(args.dataset ?? defaultDatasetPath);
const outPath = resolve(args.out ?? defaultOutPath);
const htmlPath = resolve(args.html ?? defaultHtmlPath);
const cli = args.cli ?? "bun run cli";
const modelProvider = args.modelProvider ?? Bun.env.ATLAS_EVAL_MODEL_PROVIDER;
const model = args.model ?? Bun.env.ATLAS_EVAL_MODEL;

const dataset = JSON.parse(await readFile(datasetPath, "utf8")) as EvalDataset;
const results: CaseResult[] = [];

for (const testCase of dataset.cases) {
  const startedAt = performance.now();
  const output = await runCliJson([
    ...splitCommand(cli),
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
  const diagnostics = asArray(plan.diagnostics);
  const topPaths = uniqueStrings(
    [...rankedHits, ...selected]
      .map((item) => getPath(item))
      .filter((path): path is string => path !== undefined),
  ).slice(0, 10);
  const textHaystack = JSON.stringify({ rankedHits, selected }).toLowerCase();
  const pathIncludes = testCase.expected.pathIncludes ?? [];
  const terms = testCase.expected.terms ?? [];
  const missingPathIncludes = pathIncludes.filter(
    (pathPart) => !topPaths.some((path) => path.includes(pathPart)),
  );
  const missingTerms = terms.filter(
    (term) => !textHaystack.includes(term.toLowerCase()),
  );
  const pathRecall = recall(pathIncludes.length, missingPathIncludes.length);
  const termRecall = recall(terms.length, missingTerms.length);
  const nonEmptyContext = selected.length > 0 || rankedHits.length > 0;
  results.push({
    id: testCase.id,
    category: testCase.category,
    query: testCase.query,
    passed:
      missingPathIncludes.length === 0 &&
      missingTerms.length === 0 &&
      nonEmptyContext,
    latencyMs,
    selectedCount: selected.length,
    rankedCount: rankedHits.length,
    ...(typeof plan.confidence === "string"
      ? { confidence: plan.confidence }
      : {}),
    scores: { pathRecall, termRecall, nonEmptyContext },
    missing: { pathIncludes: missingPathIncludes, terms: missingTerms },
    topPaths,
    diagnostics,
  });
}

const report = buildReport(
  dataset,
  results,
  Object.fromEntries(
    Object.entries({ provider: modelProvider, model }).filter(
      ([, value]) => value !== undefined,
    ),
  ) as { provider?: string; model?: string },
);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
await mkdir(dirname(htmlPath), { recursive: true });
await writeFile(htmlPath, renderHtml(report));
console.log(`Wrote ${outPath}`);
console.log(`Wrote ${htmlPath}`);
printTerminalSummary(report);

function printTerminalSummary(report: Report): void {
  console.log("");
  console.log("Retrieval eval");
  console.log("==============");
  console.log(`Passed: ${report.passedCases}/${report.totalCases}`);
  console.log(`Pass rate: ${percent(report.metrics.passRate)}`);
  console.log(`Path recall: ${percent(report.metrics.pathRecall)}`);
  console.log(`Term recall: ${percent(report.metrics.termRecall)}`);
  console.log(`Non-empty context: ${percent(report.metrics.nonEmptyContextRate)}`);
  console.log(`Average ranked hits: ${report.metrics.averageRankedHits}`);
  console.log(`Average latency: ${report.metrics.averageLatencyMs}ms`);

  const failed = report.cases.filter((testCase) => !testCase.passed);
  if (failed.length === 0) {
    console.log("");
    console.log("All cases passed.");
    return;
  }

  console.log("");
  console.log("Failures");
  console.log("--------");
  for (const testCase of failed) {
    console.log(
      `- ${testCase.id}: selected=${testCase.selectedCount}, ranked=${testCase.rankedCount}, path=${percent(testCase.scores.pathRecall)}, terms=${percent(testCase.scores.termRecall)}`,
    );
    if (testCase.missing.pathIncludes.length > 0) {
      console.log(
        `  missing paths: ${testCase.missing.pathIncludes.join(", ")}`,
      );
    }
    if (testCase.missing.terms.length > 0) {
      console.log(`  missing terms: ${testCase.missing.terms.join(", ")}`);
    }
    if (testCase.topPaths.length > 0) {
      console.log(`  top paths: ${testCase.topPaths.slice(0, 5).join(", ")}`);
    }
  }
}

function parseArgs(values: string[]): Record<string, string | undefined> {
  const parsed: Record<string, string | undefined> = {};
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value?.startsWith("--")) {
      parsed[value.slice(2)] = values[index + 1];
      index += 1;
    }
  }
  return parsed;
}

function splitCommand(command: string): string[] {
  return command.split(/\s+/).filter((part) => part.length > 0);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function recall(total: number, missing: number): number {
  return total === 0 ? 1 : round((total - missing) / total);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function average(values: number[]): number {
  return values.length === 0
    ? 0
    : round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function rate(
  results: CaseResult[],
  predicate: (result: CaseResult) => boolean,
): number {
  return results.length === 0
    ? 0
    : round(results.filter(predicate).length / results.length);
}

function buildReport(
  dataset: EvalDataset,
  cases: CaseResult[],
  judge: { provider?: string; model?: string },
): Report {
  const passedCases = cases.filter((result) => result.passed).length;
  return {
    dataset: dataset.name,
    ...(dataset.description === undefined
      ? {}
      : { description: dataset.description }),
    generatedAt: new Date().toISOString(),
    ...(dataset.repoId === undefined ? {} : { repoId: dataset.repoId }),
    modelJudge: {
      enabled: judge.provider !== undefined && judge.model !== undefined,
      ...(judge.provider === undefined ? {} : { provider: judge.provider }),
      ...(judge.model === undefined ? {} : { model: judge.model }),
      note: "Optional placeholder for later answer-quality grading with a cheap model such as grok-code-fast-1 via OpenRouter/xAI. Retrieval metrics run without API keys.",
    },
    researchNotes: [
      "MCPBench is the closest open-source MCP-specific benchmark, but it targets web search/database/GAIA task completion rather than local documentation retrieval, so Atlas reuses the MCP adoption idea rather than vendoring it.",
      "Promptfoo is a strong option for model/provider comparison and hosted-looking reports; this harness keeps deterministic retrieval metrics local and can export JSON for promptfoo later.",
      "Ragas and DeepEval provide RAG metrics, but add Python dependencies and LLM judges; Atlas starts with cheap deterministic path/term/latency metrics and leaves judge-model wiring optional.",
    ],
    totalCases: cases.length,
    passedCases,
    failedCases: cases.length - passedCases,
    metrics: {
      passRate: rate(cases, (result) => result.passed),
      pathRecall: average(cases.map((result) => result.scores.pathRecall)),
      termRecall: average(cases.map((result) => result.scores.termRecall)),
      nonEmptyContextRate: rate(
        cases,
        (result) => result.scores.nonEmptyContext,
      ),
      averageLatencyMs: average(cases.map((result) => result.latencyMs)),
      averageRankedHits: average(cases.map((result) => result.rankedCount)),
    },
    byCategory: byCategory(cases),
    cases,
  };
}

function byCategory(cases: CaseResult[]): Report["byCategory"] {
  const groups = new Map<string, CaseResult[]>();
  for (const result of cases) {
    groups.set(result.category, [
      ...(groups.get(result.category) ?? []),
      result,
    ]);
  }
  return Object.fromEntries(
    [...groups.entries()].map(([category, grouped]) => [
      category,
      {
        total: grouped.length,
        passed: grouped.filter((result) => result.passed).length,
        pathRecall: average(grouped.map((result) => result.scores.pathRecall)),
        termRecall: average(grouped.map((result) => result.scores.termRecall)),
        averageLatencyMs: average(grouped.map((result) => result.latencyMs)),
      },
    ]),
  );
}

function renderHtml(report: Report): string {
  const categoryRows = Object.entries(report.byCategory)
    .map(
      ([category, value]) =>
        `<tr><td>${escapeHtml(category)}</td><td>${value.passed}/${value.total}</td><td>${percent(value.pathRecall)}</td><td>${percent(value.termRecall)}</td><td>${value.averageLatencyMs}ms</td></tr>`,
    )
    .join("\n");
  const caseRows = report.cases
    .map(
      (testCase) =>
        `<tr><td>${testCase.passed ? "✅" : "❌"}</td><td>${escapeHtml(testCase.id)}</td><td>${escapeHtml(testCase.category)}</td><td>${percent(testCase.scores.pathRecall)}</td><td>${percent(testCase.scores.termRecall)}</td><td>${testCase.latencyMs}ms</td><td>${testCase.rankedCount}</td><td>${escapeHtml(testCase.topPaths.slice(0, 3).join(", "))}</td></tr>`,
    )
    .join("\n");
  const bars = [
    ["Pass rate", report.metrics.passRate],
    ["Path recall", report.metrics.pathRecall],
    ["Term recall", report.metrics.termRecall],
    ["Non-empty context", report.metrics.nonEmptyContextRate],
  ]
    .map(([label, raw]) => {
      const value = Number(raw);
      return `<div class="bar"><span>${label}</span><strong>${percent(value)}</strong><i style="width:${Math.round(value * 100)}%"></i></div>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Atlas MCP Retrieval Eval</title>
<style>
:root{color-scheme:dark;--bg:#07111f;--panel:#0d1d33;--line:#1b3658;--text:#e6f1ff;--muted:#91a4bd;--cyan:#09ecdc;--green:#6ee7b7;--red:#fb7185}body{margin:0;background:radial-gradient(circle at top,#10294a,#07111f 55%);font:15px/1.5 Inter,ui-sans-serif,system-ui;color:var(--text)}main{max-width:1180px;margin:0 auto;padding:42px 24px}.hero{border:1px solid var(--line);background:rgba(13,29,51,.82);border-radius:24px;padding:28px;box-shadow:0 30px 80px #0008}h1{font-size:44px;margin:0 0 4px}.muted{color:var(--muted)}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:22px 0}.card{background:#09182b;border:1px solid var(--line);border-radius:16px;padding:18px}.card b{font-size:28px;color:var(--cyan)}.bar{position:relative;background:#081629;border:1px solid var(--line);border-radius:12px;margin:10px 0;padding:12px;overflow:hidden}.bar i{position:absolute;inset:auto auto 0 0;height:3px;background:linear-gradient(90deg,var(--cyan),var(--green))}.bar span,.bar strong{position:relative;z-index:1}.bar strong{float:right}table{width:100%;border-collapse:collapse;margin-top:18px;background:#081629;border-radius:16px;overflow:hidden}th,td{border-bottom:1px solid var(--line);padding:10px;text-align:left;vertical-align:top}th{color:var(--cyan);font-size:12px;text-transform:uppercase;letter-spacing:.08em}.section{margin-top:28px}.note{border-left:3px solid var(--cyan);padding:10px 14px;background:#081629;border-radius:10px}@media(max-width:800px){.cards{grid-template-columns:1fr 1fr}h1{font-size:34px}}
</style>
</head>
<body><main>
<section class="hero"><h1>Atlas MCP Retrieval Eval</h1><p class="muted">${escapeHtml(report.description ?? report.dataset)} · generated ${escapeHtml(report.generatedAt)}</p>
<div class="cards"><div class="card"><span>Passed</span><br><b>${report.passedCases}/${report.totalCases}</b></div><div class="card"><span>Path recall</span><br><b>${percent(report.metrics.pathRecall)}</b></div><div class="card"><span>Term recall</span><br><b>${percent(report.metrics.termRecall)}</b></div><div class="card"><span>Avg latency</span><br><b>${report.metrics.averageLatencyMs}ms</b></div></div>
${bars}
<p class="note">Judge model: ${report.modelJudge.enabled ? `${escapeHtml(report.modelJudge.provider ?? "")} / ${escapeHtml(report.modelJudge.model ?? "")}` : "disabled"}. ${escapeHtml(report.modelJudge.note)}</p></section>
<section class="section"><h2>Category breakdown</h2><table><thead><tr><th>Category</th><th>Passed</th><th>Path recall</th><th>Term recall</th><th>Avg latency</th></tr></thead><tbody>${categoryRows}</tbody></table></section>
<section class="section"><h2>Cases</h2><table><thead><tr><th>Pass</th><th>ID</th><th>Category</th><th>Path</th><th>Terms</th><th>Latency</th><th>Ranked</th><th>Top paths</th></tr></thead><tbody>${caseRows}</tbody></table></section>
<section class="section"><h2>Reuse research</h2>${report.researchNotes.map((note) => `<p class="note">${escapeHtml(note)}</p>`).join("\n")}</section>
</main></body></html>`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
