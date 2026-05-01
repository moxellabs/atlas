export type HealthLevel = "good" | "warn" | "bad";

interface HealthThreshold {
	readonly good: number;
	readonly warn: number;
	readonly direction?: "lower";
}

export const HEALTH_THRESHOLDS = {
	passRate: { good: 1.0, warn: 0.95 },
	pathRecall: { good: 0.95, warn: 0.85 },
	termRecall: { good: 0.95, warn: 0.85 },
	nonEmptyContextRate: { good: 1.0, warn: 0.95 },
	pathRecallAt1: { good: 0.6, warn: 0.35 },
	pathRecallAt3: { good: 0.75, warn: 0.5 },
	pathRecallAt5: { good: 0.8, warn: 0.6 },
	expectedPathPrecisionAt5: { good: 0.3, warn: 0.15 },
	expectedPathNdcgAt5: { good: 0.5, warn: 0.25 },
	mrr: { good: 0.6, warn: 0.35 },
	p95LatencyMs: { good: 500, warn: 1000, direction: "lower" },
	averageLatencyMs: { good: 300, warn: 700, direction: "lower" },
	noResultAccuracy: { good: 1.0, warn: 0.95 },
	forbiddenPathAccuracy: { good: 1.0, warn: 0.95 },
} as const satisfies Record<string, HealthThreshold>;

export type HealthMetric = keyof typeof HEALTH_THRESHOLDS;

const SEVERITY_ORDER: Record<HealthLevel, number> = {
	good: 0,
	warn: 1,
	bad: 2,
};

export function classifyHealth(
	metric: HealthMetric,
	value: number,
): HealthLevel {
	const threshold = HEALTH_THRESHOLDS[metric] as HealthThreshold;
	if (threshold.direction === "lower") {
		if (value <= threshold.good) return "good";
		if (value <= threshold.warn) return "warn";
		return "bad";
	}
	if (value >= threshold.good) return "good";
	if (value >= threshold.warn) return "warn";
	return "bad";
}

export function worstHealth(levels: readonly HealthLevel[]): HealthLevel {
	return [...levels].reduce<HealthLevel>(
		(worst, level) =>
			SEVERITY_ORDER[level] > SEVERITY_ORDER[worst] ? level : worst,
		"good",
	);
}

export function severityBadge(level: HealthLevel): string {
	if (level === "bad") return "BROKEN";
	if (level === "warn") return "NEEDS WORK";
	return "PASSING";
}

export function formatMetricValue(metric: HealthMetric, value: number): string {
	if (metric === "p95LatencyMs" || metric === "averageLatencyMs") {
		return `${Math.round(value)}ms`;
	}
	if (metric === "mrr") {
		return value.toFixed(2);
	}
	return `${Math.round(value * 100)}%`;
}

export function formatThresholdTarget(metric: HealthMetric): string {
	const threshold = HEALTH_THRESHOLDS[metric] as HealthThreshold;
	if (threshold.direction === "lower") {
		return `good ≤ ${formatMetricValue(metric, threshold.good)}, warn ≤ ${formatMetricValue(metric, threshold.warn)}`;
	}
	return `good ≥ ${formatMetricValue(metric, threshold.good)}, warn ≥ ${formatMetricValue(metric, threshold.warn)}`;
}
