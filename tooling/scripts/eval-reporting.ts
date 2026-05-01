import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface EvalDataset {
  name: string;
  description?: string;
  repoId?: string;
  includes?: string[];
  cases: EvalCase[];
}

export interface EvalCaseMetadata {
  profile?: string;
  feature?: string;
  scenario?: string;
  priority?: string;
}

export interface EvalCase extends EvalCaseMetadata {
  id: string;
  category: string;
  query: string;
  repoId?: string;
  expected: EvalExpected;
}

export interface EvalExpected {
  pathIncludes?: string[];
  pathExcludes?: string[];
  terms?: string[];
  tools?: string[];
  noResults?: boolean;
  minRankedHits?: number;
  maxRankedHits?: number;
  confidence?: string;
  diagnosticsInclude?: string[];
}

export interface CaseResult extends EvalCaseMetadata {
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
    pathExcludes: string[];
    terms: string[];
    diagnosticsInclude: string[];
    rankedHits: string[];
    confidence: string[];
    noResults: string[];
  };
  topPaths: string[];
  diagnostics: unknown[];
}

export interface RuntimeInfo {
  cli: string;
  configPath?: string;
  corpusDbPath?: string;
  repoId?: string;
  repoRevision?: string;
  indexedRevision?: string;
  docCount?: number;
  source: "repo-local-artifact" | "explicit-config" | "cli-default";
}

export interface ExpectationInput {
  testCase: EvalCase;
  topPaths: string[];
  textHaystack: string;
  diagnosticsHaystack: string;
  selectedCount: number;
  rankedCount: number;
  confidence?: string;
}

export interface ExpectationResult {
  passed: boolean;
  scores: CaseResult["scores"];
  missing: CaseResult["missing"];
}

export function evaluateExpectations(input: ExpectationInput): ExpectationResult {
  const expected = input.testCase.expected;
  const pathIncludes = expected.pathIncludes ?? [];
  const pathExcludes = expected.pathExcludes ?? [];
  const terms = expected.terms ?? [];
  const diagnosticsInclude = expected.diagnosticsInclude ?? [];
  const missingPathIncludes = pathIncludes.filter(
    (pathPart) => !input.topPaths.some((path) => path.includes(pathPart)),
  );
  const matchedPathExcludes = pathExcludes.filter((pathPart) =>
    input.topPaths.some((path) => path.includes(pathPart)),
  );
  const missingTerms = terms.filter(
    (term) => !input.textHaystack.includes(term.toLowerCase()),
  );
  const missingDiagnostics = diagnosticsInclude.filter(
    (term) => !input.diagnosticsHaystack.includes(term.toLowerCase()),
  );
  const missingRankedHits: string[] = [];
  if (
    expected.minRankedHits !== undefined &&
    input.rankedCount < expected.minRankedHits
  ) {
    missingRankedHits.push(`rankedCount >= ${expected.minRankedHits}`);
  }
  if (
    expected.maxRankedHits !== undefined &&
    input.rankedCount > expected.maxRankedHits
  ) {
    missingRankedHits.push(`rankedCount <= ${expected.maxRankedHits}`);
  }
  const missingConfidence =
    expected.confidence !== undefined && input.confidence !== expected.confidence
      ? [`confidence=${expected.confidence}`]
      : [];
  const hasResults = input.selectedCount > 0 || input.rankedCount > 0;
  const missingNoResults =
    expected.noResults === true && hasResults ? ["no selected or ranked hits"] : [];
  const nonEmptyContext = hasResults;
  const nonEmptyExpectationPassed =
    expected.noResults === true ? !hasResults : nonEmptyContext;
  const missing = {
    pathIncludes: missingPathIncludes,
    pathExcludes: matchedPathExcludes,
    terms: missingTerms,
    diagnosticsInclude: missingDiagnostics,
    rankedHits: missingRankedHits,
    confidence: missingConfidence,
    noResults: missingNoResults,
  };
  return {
    passed:
      missingPathIncludes.length === 0 &&
      matchedPathExcludes.length === 0 &&
      missingTerms.length === 0 &&
      missingDiagnostics.length === 0 &&
      missingRankedHits.length === 0 &&
      missingConfidence.length === 0 &&
      missingNoResults.length === 0 &&
      nonEmptyExpectationPassed,
    scores: {
      pathRecall: recall(pathIncludes.length, missingPathIncludes.length),
      termRecall: recall(terms.length, missingTerms.length),
      nonEmptyContext,
    },
    missing,
  };
}

export interface Report {
  dataset: string;
  description?: string;
  generatedAt: string;
  repoId?: string;
  runtime: RuntimeInfo;
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

export async function loadEvalDataset(
  datasetPath: string,
): Promise<EvalDataset> {
  return loadEvalDatasetFile(resolve(datasetPath), []);
}

async function loadEvalDatasetFile(
  datasetPath: string,
  seen: string[],
): Promise<EvalDataset> {
  if (seen.includes(datasetPath)) {
    throw new Error(
      `Eval dataset include cycle: ${[...seen, datasetPath].join(" -> ")}`,
    );
  }
  const parsed = JSON.parse(await readFile(datasetPath, "utf8")) as EvalDataset;
  const includes = parsed.includes ?? [];
  const includeCases = await Promise.all(
    includes.map(async (includePath) => {
      const child = await loadEvalDatasetFile(
        resolve(dirname(datasetPath), includePath),
        [...seen, datasetPath],
      );
      return child.cases.map((testCase) => ({
        ...(child.repoId === undefined || testCase.repoId !== undefined
          ? {}
          : { repoId: child.repoId }),
        ...testCase,
      }));
    }),
  );
  const cases = [...includeCases.flat(), ...(parsed.cases ?? [])];
  assertUniqueCaseIds(cases, datasetPath);
  return {
    name: parsed.name,
    ...(parsed.description === undefined
      ? {}
      : { description: parsed.description }),
    ...(parsed.repoId === undefined ? {} : { repoId: parsed.repoId }),
    ...(includes.length === 0 ? {} : { includes }),
    cases,
  };
}

function assertUniqueCaseIds(cases: EvalCase[], datasetPath: string): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const testCase of cases) {
    if (seen.has(testCase.id)) {
      duplicates.add(testCase.id);
    }
    seen.add(testCase.id);
  }
  if (duplicates.size > 0) {
    throw new Error(
      `Duplicate eval case id(s) in ${datasetPath}: ${[...duplicates].join(", ")}`,
    );
  }
}

export function caseMetadata(testCase: EvalCase): EvalCaseMetadata {
  return Object.fromEntries(
    Object.entries({
      profile: testCase.profile,
      feature: testCase.feature,
      scenario: testCase.scenario,
      priority: testCase.priority,
    }).filter(([, value]) => value !== undefined),
  ) as EvalCaseMetadata;
}

export function buildReport(
  dataset: EvalDataset,
  cases: CaseResult[],
  runtime: RuntimeInfo,
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
    runtime,
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

export function printTerminalSummary(report: Report): void {
  console.log("");
  console.log("Retrieval eval");
  console.log("==============");
  console.log(`Corpus: ${report.runtime.corpusDbPath ?? "CLI default"}`);
  console.log(`Docs: ${report.runtime.docCount ?? "unknown"}`);
  console.log(`Passed: ${report.passedCases}/${report.totalCases}`);
  console.log(`Pass rate: ${percent(report.metrics.passRate)}`);
  console.log(`Path recall: ${percent(report.metrics.pathRecall)}`);
  console.log(`Term recall: ${percent(report.metrics.termRecall)}`);
  console.log(
    `Non-empty context: ${percent(report.metrics.nonEmptyContextRate)}`,
  );
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
    const missingOther = [
      ...testCase.missing.pathExcludes.map(
        (value) => `excluded path present: ${value}`,
      ),
      ...testCase.missing.diagnosticsInclude.map(
        (value) => `missing diagnostic: ${value}`,
      ),
      ...testCase.missing.rankedHits,
      ...testCase.missing.confidence,
      ...testCase.missing.noResults,
    ];
    if (missingOther.length > 0) {
      console.log(`  expectation gaps: ${missingOther.join(", ")}`);
    }
    if (testCase.topPaths.length > 0) {
      console.log(`  top paths: ${testCase.topPaths.slice(0, 5).join(", ")}`);
    }
  }
}

export function renderHtml(report: Report): string {
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
  const runtime = [
    `source=${report.runtime.source}`,
    `corpus=${report.runtime.corpusDbPath ?? "CLI default"}`,
    `docs=${report.runtime.docCount ?? "unknown"}`,
    ...(report.runtime.indexedRevision === undefined
      ? []
      : [`indexed=${report.runtime.indexedRevision}`]),
  ].join(" · ");
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
<p class="note">Runtime: ${escapeHtml(runtime)}</p>
<div class="cards"><div class="card"><span>Passed</span><br><b>${report.passedCases}/${report.totalCases}</b></div><div class="card"><span>Path recall</span><br><b>${percent(report.metrics.pathRecall)}</b></div><div class="card"><span>Term recall</span><br><b>${percent(report.metrics.termRecall)}</b></div><div class="card"><span>Avg latency</span><br><b>${report.metrics.averageLatencyMs}ms</b></div></div>
${bars}
<p class="note">Judge model: ${report.modelJudge.enabled ? `${escapeHtml(report.modelJudge.provider ?? "")} / ${escapeHtml(report.modelJudge.model ?? "")}` : "disabled"}. ${escapeHtml(report.modelJudge.note)}</p></section>
<section class="section"><h2>Category breakdown</h2><table><thead><tr><th>Category</th><th>Passed</th><th>Path recall</th><th>Term recall</th><th>Avg latency</th></tr></thead><tbody>${categoryRows}</tbody></table></section>
<section class="section"><h2>Cases</h2><table><thead><tr><th>Pass</th><th>ID</th><th>Category</th><th>Path</th><th>Terms</th><th>Latency</th><th>Ranked</th><th>Top paths</th></tr></thead><tbody>${caseRows}</tbody></table></section>
<section class="section"><h2>Reuse research</h2>${report.researchNotes.map((note) => `<p class="note">${escapeHtml(note)}</p>`).join("\n")}</section>
</main></body></html>`;
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

function average(values: number[]): number {
  return values.length === 0
    ? 0
    : round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function recall(total: number, missing: number): number {
  return total === 0 ? 1 : round((total - missing) / total);
}

function rate(
  results: CaseResult[],
  predicate: (result: CaseResult) => boolean,
): number {
  return results.length === 0
    ? 0
    : round(results.filter(predicate).length / results.length);
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
