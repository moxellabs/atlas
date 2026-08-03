/// <reference types="bun" />

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
	agentEffectDatasetDigest,
	loadAgentEffectDataset,
	resolveSnapshotFreshness,
} from "../../packages/eval/src/agent-effect";
import {
	renderHtml,
	type Report,
} from "../../packages/eval/src/retrieval-harness";

const args = parseArgs(Bun.argv.slice(2));
const cwd = process.cwd();
const reportPath = resolve(
	cwd,
	args.report ?? "/tmp/atlas-eval-report/mcp-retrieval-report.json",
);
const outputPath = resolve(
	cwd,
	args.out ?? "/tmp/atlas-eval-report/index.html",
);
const releaseRevision =
	args.revision ?? (await git(cwd, ["rev-parse", "HEAD"]));
const dataset = await loadAgentEffectDataset(
	resolve(cwd, args.dataset ?? "evals/datasets/luna-agent-effect.json"),
);
const effect = await resolveSnapshotFreshness({
	cwd,
	targetRevision: releaseRevision,
	dataset,
	datasetDigest: agentEffectDatasetDigest(dataset),
	changedPaths: async (fromRevision, toRevision) => {
		const diff = await git(cwd, [
			"diff",
			"--name-only",
			`${fromRevision}..${toRevision}`,
		]);
		return diff.length === 0 ? [] : diff.split("\n").filter(Boolean);
	},
});
const report = JSON.parse(await readFile(reportPath, "utf8")) as Report;
const html = renderHtml(report, { agentEffect: effect });
await writeFile(outputPath, html);
await writeFile(
	resolve(cwd, "/tmp/atlas-eval-report/atlas-eval-dashboard.json"),
	`${JSON.stringify({ retrieval: report, luna: effect }, null, 2)}\n`,
);
console.log(
	`Wrote ${outputPath}; Luna evidence is ${effect.status}${effect.status === "absent" ? "" : ` (${effect.snapshot.releaseId})`}.`,
);

async function git(cwd: string, args: string[]): Promise<string> {
	const process = Bun.spawn(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	if (exitCode !== 0)
		throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
	return stdout.trim();
}

function parseArgs(values: string[]): Record<string, string | undefined> {
	const parsed: Record<string, string | undefined> = {};
	for (let index = 0; index < values.length; index++) {
		const value = values[index];
		if (!value?.startsWith("--")) continue;
		const next = values[index + 1];
		if (next === undefined || next.startsWith("--")) {
			parsed[value.slice(2)] = "true";
			continue;
		}
		parsed[value.slice(2)] = next;
		index++;
	}
	return parsed;
}
