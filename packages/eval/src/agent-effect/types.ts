export const AGENT_EFFECT_SCHEMA_VERSION = 1 as const;

export type AgentArm = "baseline" | "treatment";
export type AgentRunStatus =
	| "completed"
	| "timeout"
	| "error"
	| "invalid-output";
export type RubricCriterionKind =
	| "fact"
	| "completion"
	| "grounding"
	| "citation"
	| "abstention"
	| "safety";

export interface AgentEffectCriterion {
	readonly id: string;
	readonly kind: RubricCriterionKind;
	readonly description: string;
	readonly evidencePaths: readonly string[];
}

export interface AgentEffectTask {
	readonly id: string;
	readonly sourceCaseId: string;
	readonly title: string;
	readonly category: string;
	readonly prompt: string;
	readonly criteria: readonly AgentEffectCriterion[];
}

export interface AgentEffectRunnerConfig {
	readonly model: string;
	readonly reasoningEffort: "low" | "medium" | "high" | "xhigh";
	readonly trialsPerTask: number;
	readonly agentTimeoutMs: number;
	readonly judgeTimeoutMs: number;
}

export interface AgentEffectDataset {
	readonly schemaVersion: typeof AGENT_EFFECT_SCHEMA_VERSION;
	readonly name: string;
	readonly description: string;
	readonly repoId: string;
	readonly runner: AgentEffectRunnerConfig;
	readonly tasks: readonly AgentEffectTask[];
}

export interface AgentCitation {
	readonly path: string;
	readonly claim: string;
}

export interface AgentAnswer {
	readonly answer: string;
	readonly citations: readonly AgentCitation[];
}

export interface McpTraceEvent {
	readonly kind: "tool" | "resource" | "web_search";
	readonly name: string;
	/** Atlas is local corpus evidence; web is an open-world fallback. */
	readonly source: "atlas" | "web";
	readonly durationMs?: number;
	readonly ok: boolean;
}

export interface McpTraceSummary {
	readonly calls: readonly McpTraceEvent[];
	readonly protocolErrors: number;
}

export interface AgentRun {
	readonly arm: AgentArm;
	readonly taskId: string;
	readonly trial: number;
	readonly startedAt: string;
	readonly durationMs: number;
	readonly status: AgentRunStatus;
	readonly answer?: AgentAnswer;
	readonly error?: string;
	readonly mcp?: McpTraceSummary;
}

export interface CriterionVerdict {
	readonly id: string;
	readonly passed: boolean;
	readonly reason: string;
}

export interface JudgedAnswer {
	readonly criteria: readonly CriterionVerdict[];
	readonly unsupportedClaimCount: number;
}

export interface PairJudgeVerdict {
	readonly baseline: JudgedAnswer;
	readonly treatment: JudgedAnswer;
}

export interface AgentEffectPair {
	readonly taskId: string;
	readonly trial: number;
	readonly order: readonly AgentArm[];
	readonly baseline: AgentRun;
	readonly treatment: AgentRun;
	readonly judge: PairJudgeVerdict;
}

export interface ArmMetrics {
	readonly runs: number;
	readonly completionRate: number;
	readonly groundedAnswerRate: number;
	readonly citationCoverageRate: number;
	readonly unsupportedClaimRate: number;
	readonly abstentionCorrectRate: number | null;
	readonly averageDurationMs: number;
	readonly p95DurationMs: number;
}

export interface AgentEffectMetrics {
	readonly pairs: number;
	readonly baseline: ArmMetrics;
	readonly treatment: ArmMetrics;
	readonly paired: {
		readonly wins: number;
		readonly ties: number;
		readonly losses: number;
	};
	readonly mcp: {
		readonly adoptionRate: number;
		readonly atlasFirstRate: number;
		readonly localOnlyRate: number;
		readonly fallbackRate: number;
		readonly averageCalls: number;
		readonly protocolErrorRate: number;
	};
}

export interface RepresentativeTrace {
	readonly kind: "largest-win" | "median-pair" | "largest-loss" | "richest-mcp";
	readonly taskId: string;
	readonly trial: number;
}

export interface AgentEffectSnapshot {
	readonly schemaVersion: typeof AGENT_EFFECT_SCHEMA_VERSION;
	readonly releaseId: string;
	readonly generatedAt: string;
	readonly provenance: {
		readonly evaluatedRevision: string;
		readonly indexedRevision?: string;
		readonly corpusDigest?: string;
		readonly datasetDigest: string;
		readonly codexVersion: string;
		readonly model: string;
		readonly reasoningEffort: AgentEffectRunnerConfig["reasoningEffort"];
	};
	readonly dataset: Pick<AgentEffectDataset, "name" | "repoId" | "runner">;
	readonly pairs: readonly AgentEffectPair[];
	readonly metrics: AgentEffectMetrics;
	readonly representativeTraces: readonly RepresentativeTrace[];
}

export type AgentEffectFreshness =
	| { readonly status: "fresh"; readonly snapshot: AgentEffectSnapshot }
	| { readonly status: "stale"; readonly snapshot: AgentEffectSnapshot }
	| { readonly status: "absent" };
