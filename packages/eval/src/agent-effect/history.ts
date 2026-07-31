import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { sanitizeEvalText, sanitizeRepoPath } from "./sanitize";
import {
	AGENT_EFFECT_SCHEMA_VERSION,
	type AgentEffectDataset,
	type AgentEffectFreshness,
	type AgentEffectSnapshot,
} from "./types";

const historyDirectory = "evals/history/luna";
const indexFile = "index.json";

interface HistoryIndex {
	readonly schemaVersion: 1;
	readonly snapshots: ReadonlyArray<{
		readonly releaseId: string;
		readonly file: string;
		readonly generatedAt: string;
		readonly evaluatedRevision: string;
		readonly datasetDigest: string;
	}>;
}

export async function writeAgentEffectSnapshot(input: {
	readonly cwd: string;
	readonly snapshot: AgentEffectSnapshot;
}): Promise<string> {
	const releaseId = safeReleaseId(input.snapshot.releaseId);
	const directory = resolve(input.cwd, historyDirectory);
	const file = `${releaseId}.json`;
	const path = join(directory, file);
	await mkdir(directory, { recursive: true });
	await writeFile(
		path,
		`${JSON.stringify(sanitizeSnapshot(input.snapshot), null, 2)}\n`,
	);
	const index = await loadHistoryIndex(directory);
	const next = {
		schemaVersion: 1 as const,
		snapshots: [
			...index.snapshots.filter((entry) => entry.releaseId !== releaseId),
			{
				releaseId,
				file,
				generatedAt: input.snapshot.generatedAt,
				evaluatedRevision: input.snapshot.provenance.evaluatedRevision,
				datasetDigest: input.snapshot.provenance.datasetDigest,
			},
		].sort((left, right) => left.generatedAt.localeCompare(right.generatedAt)),
	};
	await writeFile(
		join(directory, indexFile),
		`${JSON.stringify(next, null, 2)}\n`,
	);
	return path;
}

export async function latestCompatibleSnapshot(input: {
	readonly cwd: string;
	readonly dataset: AgentEffectDataset;
	readonly datasetDigest: string;
}): Promise<AgentEffectSnapshot | undefined> {
	const directory = resolve(input.cwd, historyDirectory);
	const index = await loadHistoryIndex(directory);
	for (const entry of [...index.snapshots].sort((left, right) =>
		right.generatedAt.localeCompare(left.generatedAt),
	)) {
		if (entry.datasetDigest !== input.datasetDigest) continue;
		const snapshot = await readSnapshot(join(directory, entry.file));
		if (
			snapshot !== undefined &&
			snapshot.dataset.runner.model === input.dataset.runner.model &&
			snapshot.dataset.runner.reasoningEffort ===
				input.dataset.runner.reasoningEffort
		) {
			return snapshot;
		}
	}
	return undefined;
}

export async function resolveSnapshotFreshness(input: {
	readonly cwd: string;
	readonly targetRevision: string;
	readonly dataset: AgentEffectDataset;
	readonly datasetDigest: string;
	readonly changedPaths: (
		fromRevision: string,
		toRevision: string,
	) => Promise<readonly string[]>;
}): Promise<AgentEffectFreshness> {
	const snapshot = await latestCompatibleSnapshot(input);
	if (snapshot === undefined) return { status: "absent" };
	if (snapshot.provenance.evaluatedRevision === input.targetRevision) {
		return { status: "fresh", snapshot };
	}
	const changed = await input.changedPaths(
		snapshot.provenance.evaluatedRevision,
		input.targetRevision,
	);
	return changed.every(
		(path) => path === "evals/history" || path.startsWith("evals/history/"),
	)
		? { status: "fresh", snapshot }
		: { status: "stale", snapshot };
}

export async function validateAgentEffectHistory(input: {
	readonly cwd: string;
	readonly dataset: AgentEffectDataset;
	readonly datasetDigest: string;
}): Promise<void> {
	const snapshot = await latestCompatibleSnapshot(input);
	if (snapshot === undefined) return;
	if (snapshot.schemaVersion !== AGENT_EFFECT_SCHEMA_VERSION) {
		throw new Error("Unsupported Luna history snapshot schema.");
	}
	if (snapshot.provenance.datasetDigest !== input.datasetDigest) {
		throw new Error(
			"Luna history snapshot does not match the current task suite.",
		);
	}
}

async function loadHistoryIndex(directory: string): Promise<HistoryIndex> {
	try {
		const value = JSON.parse(
			await readFile(join(directory, indexFile), "utf8"),
		) as unknown;
		if (!isHistoryIndex(value)) throw new Error("invalid index");
		return value;
	} catch (error) {
		if (isMissing(error)) return { schemaVersion: 1, snapshots: [] };
		throw new Error(`Invalid Luna history index: ${String(error)}`);
	}
}

async function readSnapshot(
	path: string,
): Promise<AgentEffectSnapshot | undefined> {
	try {
		const value = JSON.parse(await readFile(path, "utf8")) as unknown;
		return isSnapshot(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

function sanitizeSnapshot(snapshot: AgentEffectSnapshot): AgentEffectSnapshot {
	return {
		...snapshot,
		pairs: snapshot.pairs.map((pair) => ({
			...pair,
			baseline: sanitizeRun(pair.baseline),
			treatment: sanitizeRun(pair.treatment),
		})),
	};
}

function sanitizeRun(run: AgentEffectSnapshot["pairs"][number]["baseline"]) {
	return {
		...run,
		...(run.error === undefined
			? {}
			: { error: sanitizeEvalText(run.error, 1_000) }),
		...(run.answer === undefined
			? {}
			: {
					answer: {
						answer: sanitizeEvalText(run.answer.answer),
						citations: run.answer.citations.map((citation) => ({
							path: sanitizeRepoPath(citation.path),
							claim: sanitizeEvalText(citation.claim, 500),
						})),
					},
				}),
	};
}

function safeReleaseId(value: string): string {
	if (!/^v[0-9A-Za-z][0-9A-Za-z.-]*$/.test(value)) {
		throw new Error(
			`Invalid release ID ${value}; use a version-like value such as v0.3.0.`,
		);
	}
	return value;
}

function isHistoryIndex(value: unknown): value is HistoryIndex {
	return (
		isRecord(value) &&
		value.schemaVersion === 1 &&
		Array.isArray(value.snapshots) &&
		value.snapshots.every(
			(entry) =>
				isRecord(entry) &&
				typeof entry.releaseId === "string" &&
				typeof entry.file === "string" &&
				typeof entry.generatedAt === "string" &&
				typeof entry.evaluatedRevision === "string" &&
				typeof entry.datasetDigest === "string",
		)
	);
}

function isSnapshot(value: unknown): value is AgentEffectSnapshot {
	return (
		isRecord(value) &&
		value.schemaVersion === AGENT_EFFECT_SCHEMA_VERSION &&
		typeof value.releaseId === "string" &&
		isRecord(value.provenance) &&
		typeof value.provenance.evaluatedRevision === "string" &&
		typeof value.provenance.datasetDigest === "string" &&
		isRecord(value.dataset) &&
		Array.isArray(value.pairs) &&
		isRecord(value.metrics) &&
		Array.isArray(value.representativeTraces)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "ENOENT"
	);
}
