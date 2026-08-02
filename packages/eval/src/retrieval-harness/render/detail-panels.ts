import type { AgentEffectFreshness, AgentEffectPair } from "../../agent-effect";
import type { CaseResult, Report } from "../types";

export function renderDetailPanels(
  report: Report,
  effect: AgentEffectFreshness,
): string {
  return [
    renderAnswerQuality(effect),
    renderMcpAgent(effect),
    renderFailureAnalysis(report, effect),
    renderTrends(effect),
    renderMethodology(report, effect),
    renderReproducibility(report, effect),
  ].join("");
}

function renderAnswerQuality(effect: AgentEffectFreshness): string {
  if (effect.status === "absent")
    return unavailablePanel(
      "answer-quality",
      "Answer Quality",
      "No local Luna answer-quality snapshot has been recorded yet.",
    );
  const metrics = effect.snapshot.metrics;
  const stale = freshnessNote(effect);
  return `<section class="tab-panel" id="answer-quality" data-report-tab="answer-quality" hidden>${tabHeader("Answer Quality", "Structured Luna-judge results from paired baseline and Atlas-MCP agent answers.", stale)}<div class="tab-kpi-grid four">${metricCard("Baseline completion", percent(metrics.baseline.completionRate), `${metrics.baseline.runs} answers`, health(metrics.baseline.completionRate))}${metricCard("Treatment completion", percent(metrics.treatment.completionRate), pairedDelta(metrics.treatment.completionRate, metrics.baseline.completionRate), health(metrics.treatment.completionRate))}${metricCard("Treatment grounding", percent(metrics.treatment.groundedAnswerRate), `Unsupported ${percent(metrics.treatment.unsupportedClaimRate)}`, health(metrics.treatment.groundedAnswerRate))}${metricCard("Treatment citations", percent(metrics.treatment.citationCoverageRate), nullablePercent(metrics.treatment.abstentionCorrectRate, "No abstention tasks"), health(metrics.treatment.citationCoverageRate))}</div><div class="detail-grid two-up"><article class="data-card detail-card"><div class="card-heading"><div><span class="card-eyebrow">Paired outcome</span><h2>Atlas MCP effect</h2></div></div><dl class="repro-meta-grid"><div><dt>Treatment wins</dt><dd>${metrics.paired.wins}</dd></div><div><dt>Ties</dt><dd>${metrics.paired.ties}</dd></div><div><dt>Treatment losses</dt><dd>${metrics.paired.losses}</dd></div><div><dt>Pairs</dt><dd>${metrics.pairs}</dd></div></dl></article><article class="data-card detail-card"><div class="card-heading"><div><span class="card-eyebrow">Judge contract</span><h2>What is scored</h2></div></div><p>Each answer is graded against versioned human criteria for completion, factual grounding, repository-relative citations, safety, and abstention when applicable. The judge sees anonymous left/right answers in randomized order.</p></article></div>${representativePairs(effect.snapshot.pairs, effect.snapshot.representativeTraces).map(renderAnswerTrace).join("")}</section>`;
}

function renderMcpAgent(effect: AgentEffectFreshness): string {
  if (effect.status === "absent")
    return unavailablePanel(
      "mcp-agent",
      "Luna + Atlas MCP",
      "No local Luna MCP traces have been recorded yet.",
    );
  const metrics = effect.snapshot.metrics;
  return `<section class="tab-panel" id="mcp-agent" data-report-tab="mcp-agent" hidden>${tabHeader("Luna + Atlas MCP", "Observed evidence-capable tool activity from both arms; Atlas use is never prompted.", freshnessNote(effect))}<div class="tab-kpi-grid four">${metricCard("Atlas adoption", percent(metrics.mcp.adoptionRate), "Treatment runs with successful Atlas evidence", health(metrics.mcp.adoptionRate))}${metricCard("Atlas first", percent(metrics.mcp.atlasFirstRate), "Runs whose first successful retrieval was Atlas", health(metrics.mcp.atlasFirstRate))}${metricCard("Local-only", percent(metrics.mcp.localOnlyRate), `Successful external fallback ${percent(metrics.mcp.fallbackRate)}`, health(metrics.mcp.localOnlyRate))}${metricCard("Protocol errors", metrics.mcp.protocolErrorRate.toFixed(2), "Average per traced treatment run", metrics.mcp.protocolErrorRate === 0 ? "good" : "bad")}</div><article class="data-card detail-card"><div class="card-heading"><div><span class="card-eyebrow">Representative traces</span><h2>Observed evidence interactions</h2></div></div>${representativePairs(effect.snapshot.pairs, effect.snapshot.representativeTraces).map(renderMcpTrace).join("") || "<p>No representative trace is available in this snapshot.</p>"}</article></section>`;
}

function renderFailureAnalysis(
  report: Report,
  effect: AgentEffectFreshness,
): string {
  const retrievalFailures = report.cases.filter((item) => !item.passed);
  const agentFailures =
    effect.status === "absent"
      ? []
      : effect.snapshot.pairs
          .flatMap((pair) => [pair.baseline, pair.treatment])
          .filter((run) => run.status !== "completed");
  const unsupported =
    effect.status === "absent"
      ? 0
      : effect.snapshot.pairs.reduce(
          (total, pair) =>
            total +
            pair.judge.baseline.unsupportedClaimCount +
            pair.judge.treatment.unsupportedClaimCount,
          0,
        );
  return `<section class="tab-panel" id="failure-analysis" data-report-tab="failure-analysis" hidden>${tabHeader("Failure Analysis", "Observed deterministic and local agent failures; no inferred root causes.", effect.status === "absent" ? "Agent evidence not collected" : freshnessNote(effect))}<div class="failure-summary-strip"><article class="data-card"><span>Retrieval failures</span><strong>${retrievalFailures.length}</strong><small>of ${report.totalCases} cases</small></article><article class="data-card"><span>Agent execution failures</span><strong>${agentFailures.length}</strong><small>${effect.status === "absent" ? "not collected" : "baseline + treatment"}</small></article><article class="data-card"><span>Unsupported claims</span><strong>${unsupported}</strong><small>judge-counted material claims</small></article></div><article class="data-card detail-card"><div class="card-heading"><div><span class="card-eyebrow">Evidence worklist</span><h2>Actual failing cases</h2></div></div>${renderFailureRows(retrievalFailures, agentFailures)}</article></section>`;
}

function renderTrends(effect: AgentEffectFreshness): string {
  if (effect.status === "absent")
    return unavailablePanel(
      "trends-baselines",
      "Trends & Baselines",
      "No compatible Luna history exists yet. The first snapshot establishes a real baseline.",
    );
  const snapshot = effect.snapshot;
  return `<section class="tab-panel" id="trends-baselines" data-report-tab="trends-baselines" hidden>${tabHeader("Trends & Baselines", "Only compatible committed Luna snapshots are eligible for comparison.", freshnessNote(effect))}<article class="data-card detail-card"><div class="card-heading"><div><span class="card-eyebrow">Current compatible snapshot</span><h2>${escapeHtml(snapshot.releaseId)}</h2></div></div><dl class="repro-meta-grid"><div><dt>Generated</dt><dd>${escapeHtml(formatTimestamp(snapshot.generatedAt))}</dd></div><div><dt>Pairs</dt><dd>${snapshot.metrics.pairs}</dd></div><div><dt>Model</dt><dd>${escapeHtml(snapshot.provenance.model)}</dd></div><div><dt>Effort</dt><dd>${escapeHtml(snapshot.provenance.reasoningEffort)}</dd></div></dl><p class="muted">Historical charts remain intentionally sparse until more compatible release snapshots exist; a single point is not rendered as a fictional trend line.</p></article></section>`;
}

function renderMethodology(
  report: Report,
  effect: AgentEffectFreshness,
): string {
  const effectText =
    effect.status === "absent"
      ? "Luna evidence has not been collected for this dashboard."
      : `${effect.snapshot.dataset.runner.trialsPerTask} paired trials per task, ${effect.snapshot.metrics.pairs} pairs total, native tools baseline versus the same environment plus Atlas MCP.`;
  return `<section class="tab-panel" id="methodology" data-report-tab="methodology" hidden>${tabHeader("Methodology", "Deterministic retrieval quality and local agent-effect evidence are deliberately separate.", "Evidence boundaries")}<article class="data-card detail-card methodology-pipeline"><div class="card-heading"><div><span class="card-eyebrow">Pipeline</span><h2>What this page measures</h2></div></div><div class="pipeline-steps"><div class="pipeline-step"><span>01</span><strong>Retrieval</strong><small>${report.totalCases} deterministic path, term, rank, safety, and latency checks.</small></div><div class="pipeline-step"><span>02</span><strong>Agent</strong><small>${escapeHtml(effectText)}</small></div><div class="pipeline-step"><span>03</span><strong>Judge</strong><small>Separate Luna invocation scores human-authored criteria and unsupported claims.</small></div><div class="pipeline-step"><span>04</span><strong>Publish</strong><small>Only sanitized, versioned release evidence reaches this page.</small></div></div></article><aside class="scope-callout"><strong>Limits</strong><p>The agent benchmark covers Atlas only, runs locally outside CI, and reports observed paired results rather than a general claim about every repository or model.</p></aside></section>`;
}

function renderReproducibility(
  report: Report,
  effect: AgentEffectFreshness,
): string {
  const effectRows =
    effect.status === "absent"
      ? "<div><dt>Luna evidence</dt><dd>Not collected</dd></div>"
      : `<div><dt>Luna state</dt><dd>${effect.status}</dd></div><div><dt>Evaluated revision</dt><dd>${escapeHtml(effect.snapshot.provenance.evaluatedRevision.slice(0, 12))}</dd></div><div><dt>Task suite digest</dt><dd>${escapeHtml(effect.snapshot.provenance.datasetDigest.slice(0, 12))}</dd></div><div><dt>Codex</dt><dd>${escapeHtml(effect.snapshot.provenance.codexVersion)}</dd></div>`;
  return `<section class="tab-panel" id="reproducibility" data-report-tab="reproducibility" hidden>${tabHeader("Reproducibility", "Revision and digest data required to interpret this result, without machine-local paths.", "Public provenance")}<article class="data-card detail-card"><dl class="repro-meta-grid"><div><dt>Dataset</dt><dd>${escapeHtml(report.dataset)}</dd></div><div><dt>Repository revision</dt><dd>${escapeHtml(report.runtime.repoRevision?.slice(0, 12) ?? "not recorded")}</dd></div><div><dt>Indexed revision</dt><dd>${escapeHtml(report.runtime.indexedRevision?.slice(0, 12) ?? "not recorded")}</dd></div><div><dt>Corpus source</dt><dd>${escapeHtml(report.runtime.source)}</dd></div>${effectRows}</dl></article></section>`;
}

function unavailablePanel(id: string, title: string, message: string): string {
  return `<section class="tab-panel" id="${id}" data-report-tab="${id}" hidden>${tabHeader(title, message, "Not collected")}<article class="data-card detail-card"><p>${escapeHtml(message)}</p></article></section>`;
}

function renderAnswerTrace(pair: AgentEffectPair): string {
  const treatmentScore = pair.judge.treatment.criteria.filter(
    (criterion) => criterion.passed,
  ).length;
  const baselineScore = pair.judge.baseline.criteria.filter(
    (criterion) => criterion.passed,
  ).length;
  return `<article class="data-card detail-card evidence-card"><div class="card-heading"><div><span class="card-eyebrow">Representative pair</span><h2>${escapeHtml(pair.taskId)} · trial ${pair.trial}</h2></div><strong class="case-score">${treatmentScore} / ${baselineScore}</strong></div><div class="detail-grid two-up"><div><h3>Baseline</h3><p>${escapeHtml(pair.baseline.answer?.answer ?? pair.baseline.error ?? "No completed answer.")}</p></div><div><h3>Treatment</h3><p>${escapeHtml(pair.treatment.answer?.answer ?? pair.treatment.error ?? "No completed answer.")}</p></div></div></article>`;
}

function renderMcpTrace(pair: AgentEffectPair): string {
  const arms = [
    { label: "Baseline", run: pair.baseline },
    { label: "Treatment", run: pair.treatment },
  ];
  return arms
    .map(({ label, run }) => {
      const trace = run.mcp;
      const calls = trace?.calls ?? [];
      const steps =
        calls.length === 0
          ? '<p class="trace-empty">No evidence-capable tool activity observed.</p>'
          : calls
              .map(
                (call, index) =>
                  `<div class="trace-step"><span class="trace-index">${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(call.kind)}: ${escapeHtml(call.name)}</strong><p>${escapeHtml(call.source)} · ${call.durationMs === undefined ? "Duration not recorded" : `${call.durationMs}ms`} · ${call.ok ? "ok" : "error"}</p></div></div>`,
              )
              .join("");
      return `<div class="agent-trace"><strong>${escapeHtml(pair.taskId)} · trial ${pair.trial} · ${label}</strong>${steps}<p>Protocol errors: ${trace?.protocolErrors ?? 0}</p></div>`;
    })
    .join("");
}

function representativePairs(
  pairs: readonly AgentEffectPair[],
  representatives: ReadonlyArray<{
    readonly taskId: string;
    readonly trial: number;
  }>,
): AgentEffectPair[] {
  return representatives.flatMap(
    (reference) =>
      pairs.find(
        (pair) =>
          pair.taskId === reference.taskId && pair.trial === reference.trial,
      ) ?? [],
  );
}

function renderFailureRows(
  retrieval: readonly CaseResult[],
  agent: ReadonlyArray<{
    readonly arm: string;
    readonly taskId: string;
    readonly trial: number;
    readonly status: string;
    readonly error?: string;
  }>,
): string {
  if (retrieval.length === 0 && agent.length === 0)
    return "<p>No observed failures in the available evidence.</p>";
  return `<div class="table-wrap"><table><thead><tr><th>Layer</th><th>Case</th><th>Observed outcome</th></tr></thead><tbody>${retrieval.map((item) => `<tr><td>Retrieval</td><td><code>${escapeHtml(item.id)}</code></td><td>${escapeHtml(failureSummary(item))}</td></tr>`).join("")}${agent.map((run) => `<tr><td>Agent ${escapeHtml(run.arm)}</td><td><code>${escapeHtml(run.taskId)}</code></td><td>${escapeHtml(run.status)}${run.error === undefined ? "" : `: ${escapeHtml(run.error)}`}</td></tr>`).join("")}</tbody></table></div>`;
}

function failureSummary(item: CaseResult): string {
  return (
    [
      item.missing.pathIncludes.length > 0
        ? `missing paths: ${item.missing.pathIncludes.join(", ")}`
        : "",
      item.missing.terms.length > 0
        ? `missing terms: ${item.missing.terms.join(", ")}`
        : "",
      item.missing.pathExcludes.length > 0
        ? `forbidden paths: ${item.missing.pathExcludes.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("; ") || "deterministic expectation failed"
  );
}

function tabHeader(title: string, description: string, aside: string): string {
  return `<header class="tab-page-header"><div><span class="eyebrow">Atlas evaluation report</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div><span class="table-pill neutral">${escapeHtml(aside)}</span></header>`;
}

function metricCard(
  label: string,
  value: string,
  note: string,
  state: "good" | "warn" | "bad" | "neutral",
): string {
  return `<article class="summary-card" data-health="${state}"><div class="summary-label">${escapeHtml(label)}</div><strong>${escapeHtml(value)}</strong><span class="summary-delta">${escapeHtml(note)}</span></article>`;
}

function freshnessNote(
  effect: Exclude<AgentEffectFreshness, { status: "absent" }>,
): string {
  return effect.status === "fresh"
    ? `Fresh · ${effect.snapshot.releaseId}`
    : `Stale · evaluated ${effect.snapshot.provenance.evaluatedRevision.slice(0, 12)} on ${formatTimestamp(effect.snapshot.generatedAt)}`;
}

function health(value: number): "good" | "warn" | "bad" {
  return value >= 0.9 ? "good" : value >= 0.7 ? "warn" : "bad";
}

function pairedDelta(current: number, baseline: number): string {
  return `${current >= baseline ? "+" : ""}${((current - baseline) * 100).toFixed(1)}pp vs baseline`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
function nullablePercent(value: number | null, absent: string): string {
  return value === null
    ? absent
    : `${(value * 100).toFixed(1)}% abstention correct`;
}
function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toISOString().replace("T", " ").replace(".000Z", " UTC");
}
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
