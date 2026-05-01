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
  datasetPath?: string;
  repoId?: string;
  repoRevision?: string;
  indexedRevision?: string;
  docCount?: number;
  source: "repo-local-artifact" | "explicit-config" | "cli-default";
}

export interface ReportThresholdInput {
  minPassRate?: number;
  minPathRecall?: number;
  minTermRecall?: number;
  minNonEmptyContextRate?: number;
}

export interface ReportThresholdResult {
  metric: keyof Report["metrics"];
  label: string;
  actual: number;
  minimum: number;
  passed: boolean;
}

type ReportGroup = Record<
  string,
  {
    total: number;
    passed: number;
    passRate: number;
    pathRecall: number;
    termRecall: number;
    nonEmptyContextRate: number;
    averageLatencyMs: number;
  }
>;

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
  thresholds?: {
    passed: boolean;
    results: ReportThresholdResult[];
  };
  byCategory: ReportGroup;
  byProfile: ReportGroup;
  byFeature: ReportGroup;
  byScenario: ReportGroup;
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
  thresholds: ReportThresholdInput = {},
): Report {
  const passedCases = cases.filter((result) => result.passed).length;
  const metrics = {
    passRate: rate(cases, (result) => result.passed),
    pathRecall: average(cases.map((result) => result.scores.pathRecall)),
    termRecall: average(cases.map((result) => result.scores.termRecall)),
    nonEmptyContextRate: rate(
      cases,
      (result) => result.scores.nonEmptyContext,
    ),
    averageLatencyMs: average(cases.map((result) => result.latencyMs)),
    averageRankedHits: average(cases.map((result) => result.rankedCount)),
  };
  const thresholdResults = evaluateThresholds(metrics, thresholds);
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
    metrics,
    ...(thresholdResults.length === 0
      ? {}
      : {
          thresholds: {
            passed: thresholdResults.every((result) => result.passed),
            results: thresholdResults,
          },
        }),
    byCategory: byGroup(cases, (result) => result.category),
    byProfile: byGroup(cases, (result) => result.profile),
    byFeature: byGroup(cases, (result) => result.feature),
    byScenario: byGroup(cases, (result) => result.scenario),
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
  if (report.thresholds !== undefined) {
    console.log(`Thresholds: ${report.thresholds.passed ? "passed" : "failed"}`);
    for (const threshold of report.thresholds.results) {
      console.log(
        `- ${threshold.label}: ${percent(threshold.actual)} >= ${percent(threshold.minimum)} ${threshold.passed ? "✓" : "✗"}`,
      );
    }
  }

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
  const failed = report.cases.filter((testCase) => !testCase.passed);
  const runtimeItems: Array<[string, string]> = [
    ["Dataset", report.dataset],
    ["Generated", report.generatedAt],
    ["Runtime source", report.runtime.source],
    ["CLI", report.runtime.cli],
    ["Corpus", report.runtime.corpusDbPath ?? "CLI default"],
    ["Docs", String(report.runtime.docCount ?? "unknown")],
  ];
  if (report.runtime.repoId !== undefined) {
    runtimeItems.push(["Repo", report.runtime.repoId]);
  }
  if (report.runtime.repoRevision !== undefined) {
    runtimeItems.push(["Repo revision", report.runtime.repoRevision]);
  }
  if (report.runtime.indexedRevision !== undefined) {
    runtimeItems.push(["Indexed revision", report.runtime.indexedRevision]);
  }
  const links = [
    `<a href="../../docs/evals.md">docs/evals.md</a>`,
    ...(report.runtime.datasetPath === undefined
      ? []
      : [`<code>${escapeHtml(report.runtime.datasetPath)}</code>`]),
  ];
  const thresholdStatus = report.thresholds?.passed ?? true;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Atlas MCP Retrieval Eval</title>
<style>
:root{color-scheme:light dark;--bg:#f6f8fa;--panel:#fff;--panel2:#f6f8fa;--line:#d0d7de;--text:#1f2328;--muted:#656d76;--accent:#0969da;--ok:#1a7f37;--bad:#cf222e;--warn:#9a6700;--shadow:0 16px 45px #1f232814}@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--panel:#161b22;--panel2:#0d1117;--line:#30363d;--text:#e6edf3;--muted:#8b949e;--accent:#2f81f7;--ok:#3fb950;--bad:#f85149;--warn:#d29922;--shadow:0 18px 55px #0008}}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top left,color-mix(in srgb,var(--accent) 18%,transparent),transparent 34%),var(--bg);color:var(--text);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}main{max-width:1200px;margin:0 auto;padding:32px 18px 48px}.hero,.panel{background:var(--panel);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow)}.hero{padding:28px;margin-bottom:18px}.eyebrow{color:var(--accent);font-weight:700;text-transform:uppercase;letter-spacing:.08em;font-size:12px}h1{font-size:38px;line-height:1.1;margin:8px 0}.muted{color:var(--muted)}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-top:18px}.meta div,.chip{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:10px}.meta b,.chip b{display:block;font-size:12px;color:var(--muted);font-weight:600}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px}.card span{color:var(--muted)}.card strong{display:block;font-size:28px;margin-top:4px}.ok{color:var(--ok)}.bad{color:var(--bad)}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.panel{padding:18px;margin-top:16px;overflow:hidden}.bars{display:grid;gap:10px}.bar{display:grid;grid-template-columns:170px 1fr 52px;align-items:center;gap:10px}.track{height:10px;background:var(--panel2);border:1px solid var(--line);border-radius:999px;overflow:hidden}.fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--ok));border-radius:999px}.fill.fail{background:linear-gradient(90deg,var(--bad),var(--warn))}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-top:1px solid var(--line);padding:9px 10px;text-align:left;vertical-align:top}th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em;background:var(--panel2)}code,pre{font-family:ui-monospace,SFMono-Regular,SFMono,Consolas,"Liberation Mono",monospace}code{font-size:12px}.details{display:grid;gap:12px}.case{border:1px solid var(--line);border-radius:14px;background:var(--panel2);padding:14px}.case h3{margin:0 0 6px}.pills{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.pill{border:1px solid var(--line);border-radius:999px;padding:3px 8px;color:var(--muted);font-size:12px}.cols{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}pre{white-space:pre-wrap;margin:0;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px;max-height:220px;overflow:auto}.notes{display:grid;gap:10px}.note{border-left:3px solid var(--accent);background:var(--panel2);border-radius:10px;padding:10px 12px}@media(max-width:850px){.cards,.grid,.cols{grid-template-columns:1fr}.bar{grid-template-columns:1fr}.bar strong{text-align:left}h1{font-size:30px}}
</style>
</head>
<body><main>
<section class="hero">
  <div class="eyebrow">Atlas eval dashboard</div>
  <h1>${escapeHtml(report.dataset)}</h1>
  <p class="muted">${escapeHtml(report.description ?? "Deterministic MCP retrieval evaluation")} · ${report.passedCases}/${report.totalCases} cases passing · thresholds <span class="${thresholdStatus ? "ok" : "bad"}">${thresholdStatus ? "passing" : "failing"}</span></p>
  <p class="muted">References: ${links.join(" · ")}</p>
  <div class="meta">${runtimeItems.map(([label, value]) => `<div><b>${escapeHtml(label)}</b>${escapeHtml(value)}</div>`).join("\n")}</div>
</section>
<section class="cards">
  ${scoreCard("Pass rate", percent(report.metrics.passRate), report.metrics.passRate === 1 ? "ok" : "bad")}
  ${scoreCard("Path recall", percent(report.metrics.pathRecall), "")}
  ${scoreCard("Term recall", percent(report.metrics.termRecall), "")}
  ${scoreCard("Avg latency", `${report.metrics.averageLatencyMs}ms`, "")}
</section>
<section class="grid">
  <div class="panel"><h2>Core scores</h2><div class="bars">${metricBars(report).join("\n")}</div></div>
  <div class="panel"><h2>Threshold gates</h2>${renderThresholds(report)}</div>
</section>
${renderGroupSection("Category", report.byCategory)}
${renderGroupSection("Profile", report.byProfile)}
${renderGroupSection("Feature", report.byFeature)}
${renderGroupSection("Scenario", report.byScenario)}
<section class="panel"><h2>Failures (${failed.length})</h2>${renderFailures(failed)}</section>
<section class="panel"><h2>All cases</h2><table><thead><tr><th>Status</th><th>ID</th><th>Metadata</th><th>Scores</th><th>Hits</th><th>Top paths</th></tr></thead><tbody>${report.cases.map(renderCaseRow).join("\n")}</tbody></table></section>
<section class="panel"><h2>Reuse research</h2><div class="notes">${report.researchNotes.map((note) => `<p class="note">${escapeHtml(note)}</p>`).join("\n")}</div></section>
</main></body></html>`;
}

function scoreCard(label: string, value: string, className: string): string {
  return `<div class="card"><span>${escapeHtml(label)}</span><strong class="${className}">${escapeHtml(value)}</strong></div>`;
}

function metricBars(report: Report): string[] {
  return [
    ["Pass rate", report.metrics.passRate],
    ["Path recall", report.metrics.pathRecall],
    ["Term recall", report.metrics.termRecall],
    ["Non-empty context", report.metrics.nonEmptyContextRate],
  ].map(([label, value]) => renderProgress(String(label), Number(value)));
}

function renderProgress(label: string, value: number, failed = false): string {
  return `<div class="bar"><span>${escapeHtml(label)}</span><div class="track"><div class="fill ${failed ? "fail" : ""}" style="width:${Math.max(0, Math.min(100, Math.round(value * 100)))}%"></div></div><strong>${percent(value)}</strong></div>`;
}

function renderThresholds(report: Report): string {
  if (report.thresholds === undefined) {
    return `<p class="muted">No threshold gates supplied. Local evals report scores without failing on gates by default.</p>`;
  }
  return `<div class="bars">${report.thresholds.results
    .map((threshold) =>
      renderProgress(
        `${threshold.passed ? "✓" : "✗"} ${threshold.label} ≥ ${percent(threshold.minimum)}`,
        threshold.actual,
        !threshold.passed,
      ),
    )
    .join("\n")}</div>`;
}

function renderGroupSection(title: string, group: ReportGroup): string {
  return `<section class="panel"><h2>${escapeHtml(title)} breakdown</h2><table><thead><tr><th>${escapeHtml(title)}</th><th>Passed</th><th>Pass rate</th><th>Path recall</th><th>Term recall</th><th>Non-empty</th><th>Avg latency</th></tr></thead><tbody>${Object.entries(
    group,
  )
    .map(
      ([name, value]) =>
        `<tr><td>${escapeHtml(name)}</td><td>${value.passed}/${value.total}</td><td>${percent(value.passRate)}</td><td>${percent(value.pathRecall)}</td><td>${percent(value.termRecall)}</td><td>${percent(value.nonEmptyContextRate)}</td><td>${value.averageLatencyMs}ms</td></tr>`,
    )
    .join("\n")}</tbody></table></section>`;
}

function renderFailures(failed: CaseResult[]): string {
  if (failed.length === 0) {
    return `<p class="muted">No failed cases. All deterministic expectations passed.</p>`;
  }
  return `<div class="details">${failed.map(renderFailure).join("\n")}</div>`;
}

function renderFailure(testCase: CaseResult): string {
  const missingOther = [
    ...testCase.missing.pathExcludes.map((value) => `Excluded path present: ${value}`),
    ...testCase.missing.diagnosticsInclude.map((value) => `Missing diagnostic: ${value}`),
    ...testCase.missing.rankedHits,
    ...testCase.missing.confidence,
    ...testCase.missing.noResults,
  ];
  return `<article class="case"><h3>${escapeHtml(testCase.id)}</h3>${renderMetadataPills(testCase)}<p><b>Query:</b> ${escapeHtml(testCase.query)}</p><div class="cols"><div><b>Missing paths</b><pre>${escapeHtml(formatList(testCase.missing.pathIncludes))}</pre></div><div><b>Missing terms</b><pre>${escapeHtml(formatList(testCase.missing.terms))}</pre></div><div><b>Other expectation gaps</b><pre>${escapeHtml(formatList(missingOther))}</pre></div><div><b>Top paths</b><pre>${escapeHtml(formatList(testCase.topPaths.slice(0, 10)))}</pre></div></div><p class="muted">Scores: path ${percent(testCase.scores.pathRecall)}, terms ${percent(testCase.scores.termRecall)}, non-empty context ${testCase.scores.nonEmptyContext ? "yes" : "no"}; selected ${testCase.selectedCount}, ranked ${testCase.rankedCount}, latency ${testCase.latencyMs}ms.</p><b>Diagnostics summary</b><pre>${escapeHtml(summarizeDiagnostics(testCase.diagnostics))}</pre></article>`;
}

function renderCaseRow(testCase: CaseResult): string {
  return `<tr><td>${testCase.passed ? "✅ pass" : "❌ fail"}</td><td><code>${escapeHtml(testCase.id)}</code></td><td>${renderMetadataPills(testCase)}</td><td>path ${percent(testCase.scores.pathRecall)}<br>terms ${percent(testCase.scores.termRecall)}<br>context ${testCase.scores.nonEmptyContext ? "yes" : "no"}</td><td>selected ${testCase.selectedCount}<br>ranked ${testCase.rankedCount}<br>${testCase.latencyMs}ms</td><td>${escapeHtml(testCase.topPaths.slice(0, 4).join("\n"))}</td></tr>`;
}

function renderMetadataPills(testCase: CaseResult): string {
  const metadata: Array<[string, string]> = [
    ["category", testCase.category],
    ["profile", testCase.profile ?? "unknown"],
    ["feature", testCase.feature ?? "unknown"],
    ["scenario", testCase.scenario ?? "unknown"],
  ];
  if (testCase.priority !== undefined) {
    metadata.push(["priority", testCase.priority]);
  }
  return `<div class="pills">${metadata.map(([label, value]) => `<span class="pill">${escapeHtml(label)}: ${escapeHtml(value)}</span>`).join("")}</div>`;
}

function formatList(values: string[]): string {
  return values.length === 0 ? "None" : values.join("\n");
}

function summarizeDiagnostics(diagnostics: unknown[]): string {
  if (diagnostics.length === 0) {
    return "None";
  }
  return JSON.stringify(diagnostics.slice(0, 5), null, 2);
}

function byGroup(
  cases: CaseResult[],
  keyFor: (result: CaseResult) => string | undefined,
): ReportGroup {
  const groups = new Map<string, CaseResult[]>();
  for (const result of cases) {
    const key = normalizeGroupKey(keyFor(result));
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([group, grouped]) => [
        group,
        {
          total: grouped.length,
          passed: grouped.filter((result) => result.passed).length,
          passRate: rate(grouped, (result) => result.passed),
          pathRecall: average(grouped.map((result) => result.scores.pathRecall)),
          termRecall: average(grouped.map((result) => result.scores.termRecall)),
          nonEmptyContextRate: rate(
            grouped,
            (result) => result.scores.nonEmptyContext,
          ),
          averageLatencyMs: average(grouped.map((result) => result.latencyMs)),
        },
      ]),
  );
}

function normalizeGroupKey(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? "unknown" : trimmed;
}

function evaluateThresholds(
  metrics: Report["metrics"],
  thresholds: ReportThresholdInput,
): ReportThresholdResult[] {
  return [
    thresholdResult("passRate", "Pass rate", metrics.passRate, thresholds.minPassRate),
    thresholdResult("pathRecall", "Path recall", metrics.pathRecall, thresholds.minPathRecall),
    thresholdResult("termRecall", "Term recall", metrics.termRecall, thresholds.minTermRecall),
    thresholdResult(
      "nonEmptyContextRate",
      "Non-empty context",
      metrics.nonEmptyContextRate,
      thresholds.minNonEmptyContextRate,
    ),
  ].filter((result): result is ReportThresholdResult => result !== undefined);
}

function thresholdResult(
  metric: ReportThresholdResult["metric"],
  label: string,
  actual: number,
  minimum: number | undefined,
): ReportThresholdResult | undefined {
  if (minimum === undefined) {
    return undefined;
  }
  return {
    metric,
    label,
    actual,
    minimum,
    passed: actual >= minimum,
  };
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
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
