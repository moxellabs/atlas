import type { HealthMetric } from "./health";
import { formatThresholdTarget } from "./health";

export interface MetricGlossaryEntry {
	readonly label: string;
	readonly short: string;
	readonly long: string;
	readonly interpretation: string;
	readonly targets: string;
}

export const METRIC_GLOSSARY: Record<HealthMetric, MetricGlossaryEntry> = {
	passRate: {
		label: "Pass rate",
		short:
			"Fraction of cases that passed every deterministic expectation declared in the dataset.",
		long: "Each case declares required path substrings, required terms, forbidden paths, diagnostic markers, and optional no-result behavior. Pass means every gate passed. It does not say anything about rank order.",
		interpretation:
			"Drops usually mean a corpus regression (paths moved or docs deleted) or a new case with a broken expectation, not a ranker bug.",
		targets: "",
	},
	pathRecall: {
		label: "Path recall",
		short:
			"Fraction of expected path substrings found anywhere in the top retrieved paths.",
		long: "This is the coarse recall signal that tolerates ranking noise. Recall@k is the rank-aware variant you usually want.",
		interpretation:
			"If this is red, Atlas is missing known-good evidence entirely. Check corpus ingest and filters.",
		targets: "",
	},
	termRecall: {
		label: "Term recall",
		short:
			"Fraction of expected terms found in the selected/ranked context or in the retrieved source contents.",
		long: "Uses the concatenated ranked hits, selected hits, context packet, and local file contents of retrieved paths as the haystack.",
		interpretation:
			"Red usually means the docs exist but the terms have been renamed/moved, or context packing dropped them.",
		targets: "",
	},
	nonEmptyContextRate: {
		label: "Non-empty context",
		short: "Fraction of cases where Atlas returned any selected or ranked hit.",
		long: "No-result cases that explicitly expect empty results are still considered non-empty-context-correct when they abstain.",
		interpretation:
			"Red on a normal case means retrieval returned nothing. Red on a no-result case means Atlas refused to abstain when it should have.",
		targets: "",
	},
	pathRecallAt1: {
		label: "Recall@1",
		short:
			"Fraction of expected paths that appear as the single top-ranked result.",
		long: "Strictest rank quality signal. Answers: did we put the right file first?",
		interpretation:
			"Red means the ranker is not surfacing known-good evidence at position 1 even when it has the doc indexed.",
		targets: "",
	},
	pathRecallAt3: {
		label: "Recall@3",
		short: "Fraction of expected paths in the top 3 retrieved paths.",
		long: "Practical first-glance window most agents actually read.",
		interpretation:
			"Red here plus green Recall@5 means evidence is indexed but pushed past the first screenful.",
		targets: "",
	},
	pathRecallAt5: {
		label: "Recall@5",
		short: "Fraction of expected paths in the top 5 retrieved paths.",
		long: "Default reading-window metric. Expected paths are substring labels declared per case.",
		interpretation:
			"Red means the ranker is dropping known-good docs outside the reading window. Fix ranking signals, not the index.",
		targets: "",
	},
	expectedPathPrecisionAt5: {
		label: "Expected-path P@5",
		short: "Lower-bound sparse-label precision over top-5 retrieved paths.",
		long: "Only labeled expected paths are treated as relevant. Unlabeled but genuinely relevant docs make true precision higher. Do not compare across datasets with different label densities.",
		interpretation:
			"Use for trending within the same dataset. Drops suggest top-5 is dominated by off-topic paths.",
		targets: "",
	},
	expectedPathNdcgAt5: {
		label: "Expected-path nDCG@5",
		short: "Rank-sensitive binary relevance over sparse expected path labels.",
		long: "Rewards earlier expected paths more than later ones. Sparse labels mean this is a lower bound on true nDCG.",
		interpretation:
			"Drops mean known-good paths moved later in the list even if they are still inside top-5.",
		targets: "",
	},
	mrr: {
		label: "MRR",
		short: "Mean reciprocal rank of the first expected path.",
		long: "Averages 1 / rank of the first labeled hit across cases. Missing-label cases contribute 0.",
		interpretation:
			"Best single number for 'how early does Atlas put the right doc'. Red means expected evidence is consistently past rank 3.",
		targets: "",
	},
	p95LatencyMs: {
		label: "p95 latency",
		short:
			"95th-percentile wall-clock time of the local CLI retrieval call, per case.",
		long: "Measured end-to-end inside the eval harness. Includes CLI process spawn on each case; a long-lived server process would be faster.",
		interpretation:
			"Red means the slowest tail is dragging; often corpus-size sensitive. Amber on this page is fine for local dev; CI gate is looser.",
		targets: "",
	},
	averageLatencyMs: {
		label: "Avg latency",
		short: "Arithmetic mean of per-case retrieval latency.",
		long: "Pair with p95 to see whether slowness is uniform or tail-heavy.",
		interpretation:
			"Red average usually tracks cold-start overhead or an oversized corpus window.",
		targets: "",
	},
	noResultAccuracy: {
		label: "Abstain accuracy",
		short:
			"Fraction of cases where Atlas correctly abstained from returning hits.",
		long: "Only counts cases that explicitly declare noResults=true. Pass means zero selected and zero ranked hits for those cases.",
		interpretation:
			"Red means Atlas is inventing evidence on queries that should return nothing. Safety regression.",
		targets: "",
	},
	forbiddenPathAccuracy: {
		label: "Forbidden-path accuracy",
		short:
			"Fraction of cases that kept excluded paths out of the top retrieved list.",
		long: "Excluded path substrings come from the case definition. Negative/edge cases use this to guard against surfacing archived or private docs.",
		interpretation:
			"Red means retrieval leaked a path it was told to avoid. Also a safety regression.",
		targets: "",
	},
};

for (const metric of Object.keys(METRIC_GLOSSARY) as HealthMetric[]) {
	(METRIC_GLOSSARY[metric] as { targets: string }).targets =
		formatThresholdTarget(metric);
}
