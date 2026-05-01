import { relative } from "node:path";

interface EvalProgressReporterOptions {
	readonly quiet: boolean;
	readonly tty: boolean;
}

function formatEvalElapsed(ms: number): string {
	if (ms < 1000) {
		return `${Math.max(0, Math.round(ms))}ms`;
	}
	const sec = Math.round(ms / 1000);
	if (sec < 60) {
		return `${sec}s`;
	}
	const m = Math.floor(sec / 60);
	const r = sec % 60;
	return `${m}m${String(r).padStart(2, "0")}s`;
}

function formatEvalEtaMs(etaMs: number): string {
	if (!Number.isFinite(etaMs) || etaMs <= 0) {
		return "";
	}
	const sec = Math.ceil(etaMs / 1000);
	if (sec < 60) {
		return `~${sec}s left`;
	}
	const m = Math.floor(sec / 60);
	const r = sec % 60;
	return `~${m}m${String(r).padStart(2, "0")}s left`;
}

function truncateEvalId(id: string, maxChars: number): string {
	if (id.length <= maxChars) {
		return id;
	}
	if (maxChars <= 1) {
		return "…";
	}
	return `${id.slice(0, maxChars - 1)}…`;
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function renderEvalProgressBar(
	done: number,
	total: number,
	width: number,
	useColor: boolean,
): string {
	if (total <= 0) {
		return "░".repeat(width);
	}
	const filled = Math.min(width, Math.max(0, Math.round((done / total) * width)));
	const track = width - filled;
	if (!useColor) {
		return `${"█".repeat(filled)}${"░".repeat(track)}`;
	}
	return `\x1b[32m${"█".repeat(filled)}\x1b[90m${"░".repeat(track)}\x1b[0m`;
}

export function createEvalProgressReporter(options: EvalProgressReporterOptions): {
	readonly banner: (input: {
		readonly datasetPath: string;
		readonly caseCount: number;
		readonly outPath: string;
		readonly htmlPath: string;
		readonly corpusLabel: string;
		readonly docCount: number | string;
	}) => void;
	readonly tick: (input: {
		readonly index: number;
		readonly total: number;
		readonly caseId: string;
		readonly passed: boolean;
		readonly latencyMs: number;
		readonly passSoFar: number;
		readonly failSoFar: number;
	}) => void;
	readonly done: (input: {
		readonly elapsedMs: number;
		readonly passSoFar: number;
		readonly failSoFar: number;
		readonly total: number;
	}) => void;
} {
	const useColor =
		options.tty &&
		process.env.NO_COLOR === undefined &&
		process.env.FORCE_COLOR !== "0" &&
		process.env.TERM !== "dumb";

	const dim = (text: string) => (useColor ? `\x1b[2m${text}\x1b[0m` : text);
	const bold = (text: string) => (useColor ? `\x1b[1m${text}\x1b[0m` : text);
	const green = (text: string) => (useColor ? `\x1b[32m${text}\x1b[0m` : text);
	const red = (text: string) => (useColor ? `\x1b[31m${text}\x1b[0m` : text);

	const latencies: number[] = [];
	let dirtyLine = false;
	const cols = process.stderr.columns ?? 100;

	return {
		banner(input) {
			if (options.quiet) {
				return;
			}
			const rule = "─".repeat(Math.min(44, Math.max(24, cols - 4)));
			const docLabel =
				typeof input.docCount === "number"
					? input.docCount.toLocaleString("en-US")
					: input.docCount;
			process.stderr.write("\n");
			process.stderr.write(`${bold("Atlas retrieval eval")}\n`);
			process.stderr.write(`${dim(rule)}\n`);
			process.stderr.write(`  ${dim("Dataset")}  ${relPathFriendly(input.datasetPath)}\n`);
			process.stderr.write(`  ${dim("Cases")}    ${String(input.caseCount)}\n`);
			process.stderr.write(`  ${dim("Corpus")}   ${input.corpusLabel}\n`);
			process.stderr.write(`  ${dim("Docs")}     ${docLabel}\n`);
			process.stderr.write(`  ${dim("JSON")}     ${relPathFriendly(input.outPath)}\n`);
			process.stderr.write(`  ${dim("HTML")}     ${relPathFriendly(input.htmlPath)}\n`);
			process.stderr.write("\n");
		},

		tick(input) {
			if (options.quiet) {
				return;
			}
			latencies.push(input.latencyMs);
			const tail = latencies.slice(-12);
			const avg = tail.reduce((acc, ms) => acc + ms, 0) / Math.max(1, tail.length);
			const remaining = input.total - input.index;
			const etaText = remaining > 0 ? formatEvalEtaMs(remaining * avg) : "";
			const etaSuffix = etaText ? dim(` · ${etaText}`) : "";

			if (!options.tty) {
				const mark = input.passed ? green("✓") : red("✗");
				const w = String(input.total).length;
				const idx = String(input.index).padStart(w, " ");
				process.stderr.write(
					`  [${idx}/${input.total}] ${mark} ${input.latencyMs}ms  ${truncateEvalId(input.caseId, 72)}\n`,
				);
				return;
			}

			const barWidth = 20;
			const bar = renderEvalProgressBar(input.index, input.total, barWidth, useColor);
			const failPart =
				input.failSoFar > 0 ? red(` ${input.failSoFar} fail`) : dim(" 0 fail");
			const core = `${bar} ${dim(`${input.index}/${input.total}`)}  ${green(`${input.passSoFar} ok`)}${failPart}  ${dim(`${input.latencyMs}ms`)}${etaSuffix}`;
			const used = stripAnsi(core).length + 2;
			const idBudget = Math.max(8, cols - used);
			const idShown = truncateEvalId(input.caseId, idBudget);
			process.stderr.write(`\r  ${core}  ${dim(idShown)}\x1b[K`);
			dirtyLine = true;
		},

		done(input) {
			if (options.quiet) {
				return;
			}
			if (dirtyLine && options.tty) {
				process.stderr.write("\n");
			}
			dirtyLine = false;

			if (input.total === 0) {
				process.stderr.write(`${dim("  (no cases in dataset)")}\n\n`);
				return;
			}

			const parts: string[] = [
				dim("  Done"),
				bold(String(input.total)),
				dim("cases in"),
				bold(formatEvalElapsed(input.elapsedMs)),
				dim("·"),
				green(`${input.passSoFar} ok`),
			];
			if (input.failSoFar > 0) {
				parts.push(dim("·"), red(`${input.failSoFar} failed`));
			}
			process.stderr.write(`${parts.join(" ")}\n\n`);
		},
	};
}

function relPathFriendly(absolute: string): string {
	const r = relative(process.cwd(), absolute);
	if (r === "") {
		return ".";
	}
	return r.startsWith("..") || absolute === r ? absolute : r;
}

