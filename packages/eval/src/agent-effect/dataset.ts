import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
	AGENT_EFFECT_SCHEMA_VERSION,
	type AgentEffectDataset,
	type AgentEffectTask,
	type RubricCriterionKind,
	type AgentRoutingExpectation,
} from "./types";

const criterionKinds = new Set<RubricCriterionKind>([
	"fact",
	"completion",
	"grounding",
	"citation",
	"abstention",
	"safety",
]);

/** Loads the human-authored benchmark and rejects malformed or ambiguous task contracts. */
export async function loadAgentEffectDataset(
	path: string,
): Promise<AgentEffectDataset> {
	const raw = await readFile(path, "utf8");
	const value = JSON.parse(raw) as unknown;
	if (!isRecord(value))
		throw new Error(`Invalid agent-effect dataset: ${path}`);
	if (value.schemaVersion !== AGENT_EFFECT_SCHEMA_VERSION) {
		throw new Error(`Unsupported agent-effect dataset schema in ${path}`);
	}
	if (
		typeof value.name !== "string" ||
		typeof value.description !== "string" ||
		typeof value.repoId !== "string" ||
		!isRecord(value.runner) ||
		!Array.isArray(value.tasks)
	) {
		throw new Error(`Invalid agent-effect dataset shape: ${path}`);
	}
	const runner = value.runner;
	if (
		typeof runner.model !== "string" ||
		!isEffort(runner.reasoningEffort) ||
		!isPositiveInteger(runner.trialsPerTask) ||
		!isPositiveInteger(runner.agentTimeoutMs) ||
		!isPositiveInteger(runner.judgeTimeoutMs)
	) {
		throw new Error(`Invalid agent-effect runner configuration: ${path}`);
	}
	const tasks = value.tasks.map((task, index) => parseTask(task, index, path));
	const ids = new Set(tasks.map((task) => task.id));
	if (ids.size !== tasks.length || tasks.length === 0) {
		throw new Error(
			`Agent-effect task IDs must be unique and non-empty: ${path}`,
		);
	}
	return {
		schemaVersion: AGENT_EFFECT_SCHEMA_VERSION,
		name: value.name,
		description: value.description,
		repoId: value.repoId,
		runner: {
			model: runner.model,
			reasoningEffort: runner.reasoningEffort,
			trialsPerTask: runner.trialsPerTask,
			agentTimeoutMs: runner.agentTimeoutMs,
			judgeTimeoutMs: runner.judgeTimeoutMs,
		},
		tasks,
	};
}

export function agentEffectDatasetDigest(dataset: AgentEffectDataset): string {
	return createHash("sha256").update(JSON.stringify(dataset)).digest("hex");
}

function parseTask(
	value: unknown,
	index: number,
	path: string,
): AgentEffectTask {
	if (!isRecord(value)) throw new Error(`Invalid task ${index} in ${path}`);
	if (
		typeof value.id !== "string" ||
		typeof value.sourceCaseId !== "string" ||
		typeof value.title !== "string" ||
		typeof value.category !== "string" ||
		typeof value.prompt !== "string" ||
		!Array.isArray(value.criteria) ||
		value.criteria.length === 0
	) {
		throw new Error(`Invalid task ${index} in ${path}`);
	}
	const criteria = value.criteria.map((criterion, criterionIndex) => {
		if (
			!isRecord(criterion) ||
			typeof criterion.id !== "string" ||
			!criterionKinds.has(criterion.kind as RubricCriterionKind) ||
			typeof criterion.description !== "string" ||
			!isStringArray(criterion.evidencePaths)
		) {
			throw new Error(
				`Invalid criterion ${criterionIndex} for task ${value.id}`,
			);
		}
		return {
			id: criterion.id,
			kind: criterion.kind as RubricCriterionKind,
			description: criterion.description,
			evidencePaths: criterion.evidencePaths,
		};
	});
	if (
		new Set(criteria.map((criterion) => criterion.id)).size !== criteria.length
	) {
		throw new Error(`Criterion IDs must be unique for task ${value.id}`);
	}
	return {
		id: value.id,
		sourceCaseId: value.sourceCaseId,
		title: value.title,
		category: value.category,
		prompt: value.prompt,
		...(value.routing === undefined
			? {}
			: { routing: parseRouting(value.routing, value.id) }),
		criteria,
	};
}

function parseRouting(value: unknown, taskId: string): AgentRoutingExpectation {
	if (
		!isRecord(value) ||
    !isStringArray(value.firstTools) ||
    value.firstTools.length === 0 ||
    value.firstTools.some((tool) => !tool.includes(":")) ||
    !Number.isInteger(value.maxAtlasCalls) ||
    typeof value.maxAtlasCalls !== "number" ||
    value.maxAtlasCalls < 0 ||
		!["required", "forbidden", "allowed"].includes(
			String(value.externalFallback),
		) ||
		(value.allowRepeatedAtlasTools !== undefined &&
			typeof value.allowRepeatedAtlasTools !== "boolean")
	) {
		throw new Error(`Invalid routing expectation for task ${taskId}`);
	}
	return {
    firstTools: value.firstTools,
		maxAtlasCalls: value.maxAtlasCalls,
		externalFallback: value.externalFallback as
			| "required"
			| "forbidden"
			| "allowed",
		...(value.allowRepeatedAtlasTools === undefined
			? {}
			: { allowRepeatedAtlasTools: value.allowRepeatedAtlasTools }),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((entry) => typeof entry === "string")
	);
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isEffort(
	value: unknown,
): value is "low" | "medium" | "high" | "xhigh" {
	return (
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "xhigh"
	);
}
