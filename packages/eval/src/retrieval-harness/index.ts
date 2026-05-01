export {
	classifyHealth,
	HEALTH_THRESHOLDS,
	type HealthLevel,
	type HealthMetric,
} from "./health";
export { METRIC_GLOSSARY, type MetricGlossaryEntry } from "./metric-glossary";
export { loadEvalDataset, caseMetadata } from "./dataset";
export { evaluateExpectations } from "./expectations";
export { loadBaseline, baselineSummaryFromReport } from "./baseline";
export { buildReport } from "./report";
export { printTerminalSummary } from "./terminal";
export { renderHtml } from "./render/html";

export type {
	AttentionArea,
	BaselineSummary,
	CaseResult,
	EvalCase,
	EvalCaseMetadata,
	EvalDataset,
	EvalExpected,
	ExpectationInput,
	ExpectationResult,
	MetricDeltaEntry,
	NarrativeFinding,
	QualityGroupSummary,
	RankBucket,
	RegressionEntry,
	Report,
	ReportDeltas,
	ReportGroup,
	ReportGroupEntry,
	ReportThresholdInput,
	ReportThresholdResult,
	RuntimeInfo,
	WeakCaseSummary,
} from "./types";
