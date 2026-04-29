import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createFakeRepo,
	productionLikeFakeRepoFiles,
} from "../../packages/testkit/src/fake-repo";

interface CliRun {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

const cli = join(process.cwd(), "apps/cli/src/index.ts");

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function assertIncludes(
	haystack: string,
	needle: string,
	context: string,
): void {
	assert(
		haystack.includes(needle),
		`${context}: expected output to include ${JSON.stringify(needle)}\n${haystack}`,
	);
}

function assertExcludesAny(
	haystack: string,
	needles: readonly string[],
	context: string,
): void {
	const lower = haystack.toLowerCase();
	const found = needles.find((needle) => lower.includes(needle.toLowerCase()));
	assert(
		found === undefined,
		`${context}: unexpected setup branding term ${JSON.stringify(found)}\n${haystack}`,
	);
}

async function runAtlas(
	args: readonly string[],
	options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<CliRun> {
	const child = Bun.spawn(["bun", cli, ...args], {
		cwd: options.cwd ?? process.cwd(),
		env: { ...Bun.env, ...options.env },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

function parseJson<T>(run: CliRun, context: string): T {
	try {
		return JSON.parse(run.stdout) as T;
	} catch (error) {
		throw new Error(
			`${context}: failed to parse JSON output: ${(error as Error).message}\nSTDOUT:\n${run.stdout}\nSTDERR:\n${run.stderr}`,
		);
	}
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
	const child = Bun.spawn(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exitCode === 0) return stdout.trim();
	throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${stderr.trim()}`);
}

async function createProductionCheckout(root: string): Promise<string> {
	const repo = join(root, "production-repo");
	await createFakeRepo({
		rootPath: repo,
		files: productionLikeFakeRepoFiles({ includeIgnoredBrokenDocs: true }),
		commit: true,
	});
	await git(repo, [
		"remote",
		"add",
		"origin",
		"git@github.com:acme/production-repo.git",
	]);
	await git(repo, ["checkout", "-b", "local-only-uat"]);
	await writeFile(
		join(repo, "docs", "local-only.md"),
		"# Local Only\n\nDocumentation that exists only on the local branch.\n",
	);
	await git(repo, ["add", "docs/local-only.md"]);
	await git(repo, ["commit", "-m", "local only docs"]);
	return repo;
}

async function main(): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "atlas-production-uat-"));
	try {
		const home = join(root, "home");
		const config = join(root, "atlas.yaml");
		const env = { HOME: home };

		const help = await runAtlas(["--help"], { env });
		assert(help.exitCode === 0, `atlas --help failed: ${help.stderr}`);
		assertIncludes(help.stdout, "Quick path:", "top-level help");
		assertIncludes(help.stdout, "atlas setup", "top-level help");
		assertIncludes(help.stdout, "atlas repo add <repo>", "top-level help");
		assertIncludes(help.stdout, "atlas init && atlas build", "top-level help");
		assertIncludes(help.stdout, "atlas index <path>", "top-level help");
		assertIncludes(help.stdout, "atlas next", "top-level help");

		const setupHelp = await runAtlas(["setup", "--help"], { env });
		assert(
			setupHelp.exitCode === 0,
			`atlas setup --help failed: ${setupHelp.stderr}`,
		);
		assertExcludesAny(
			setupHelp.stdout,
			[
				"branding",
				"brand",
				"logo",
				"color",
				"productName",
				"namespace",
				"mcp title",
				"resource prefix",
			],
			"setup help",
		);

		const freshNext = await runAtlas(
			["next", "--json", "--config", config, "--cwd", root],
			{ env },
		);
		assert(freshNext.exitCode === 0, `fresh next failed: ${freshNext.stderr}`);
		const freshNextJson = parseJson<{ data: { recommendedCommand: string } }>(
			freshNext,
			"fresh next",
		);
		assert(
			freshNextJson.data.recommendedCommand === "atlas setup",
			`fresh next recommended ${freshNextJson.data.recommendedCommand}`,
		);

		const setup = await runAtlas(
			[
				"setup",
				"--json",
				"--non-interactive",
				"--config",
				config,
				"--cache-dir",
				join(root, "runtime"),
				"--cwd",
				root,
			],
			{ env },
		);
		assert(
			setup.exitCode === 0,
			`setup failed: ${setup.stderr}\n${setup.stdout}`,
		);

		const afterSetupNext = await runAtlas(
			["next", "--json", "--config", config, "--cwd", root],
			{ env },
		);
		const afterSetupNextJson = parseJson<{
			data: { recommendedCommand: string };
		}>(afterSetupNext, "next after setup");
		assert(
			afterSetupNextJson.data.recommendedCommand === "atlas repo add <repo>",
			`setup next recommended ${afterSetupNextJson.data.recommendedCommand}`,
		);

		const repo = await createProductionCheckout(root);

		const repoAdd = await runAtlas(
			[
				"repo",
				"add",
				repo,
				"--json",
				"--non-interactive",
				"--config",
				config,
				"--missing-artifact-action",
				"skip",
				"--cwd",
				root,
			],
			{ env },
		);
		assert(
			repoAdd.exitCode === 0,
			`repo add alias failed: ${repoAdd.stderr}\n${repoAdd.stdout}`,
		);
		const repoAddJson = parseJson<{
			command: string;
			data: { repoId: string; selectedAction: string };
		}>(repoAdd, "repo add");
		assert(
			repoAddJson.command === "add-repo",
			"repo add must delegate to add-repo",
		);
		assert(
			repoAddJson.data.repoId === "github.com/acme/production-repo",
			"repo add inferred GitHub repo id",
		);
		assert(
			repoAddJson.data.selectedAction === "skip",
			"repo add skip missing artifact",
		);

		const init = await runAtlas(
			[
				"init",
				"--json",
				"--non-interactive",
				"--ref-mode",
				"current-checkout",
				"--cwd",
				repo,
			],
			{ env },
		);
		assert(init.exitCode === 0, `init failed: ${init.stderr}\n${init.stdout}`);
		const initJson = parseJson<{
			data: {
				repoId: string;
				refMode: string;
				targetResolution: { source: string };
			};
		}>(init, "init");
		assert(
			initJson.data.repoId === "github.com/acme/production-repo",
			"init inferred repo id from Git origin",
		);
		assert(
			initJson.data.refMode === "current-checkout",
			"init preserved current-checkout ref mode",
		);
		assert(
			initJson.data.targetResolution.source === "git-origin",
			"init used Git origin without host setup prompt",
		);

		const topology = await runAtlas(
			["inspect", "topology", "--live", "--json", "--cwd", repo],
			{ env },
		);
		assert(
			topology.exitCode === 0,
			`topology failed: ${topology.stderr}\n${topology.stdout}`,
		);
		const topologyJson = parseJson<{ data: { docs: unknown[] } }>(
			topology,
			"topology",
		);
		assert(
			topologyJson.data.docs.length > 0,
			"topology should discover docs in local-only checkout",
		);

		await writeFile(
			join(repo, "docs", "broken-frontmatter.md"),
			"---\ndescription: intentionally broken\n# Missing closing frontmatter\n",
		);
		await git(repo, ["add", "docs/broken-frontmatter.md"]);
		await git(repo, ["commit", "-m", "add intentionally broken doc"]);

		const build = await runAtlas(
			["build", "--json", "--verbose", "--cwd", repo],
			{ env },
		);
		assert(
			build.exitCode !== 0,
			"production UAT expects fixture build to fail for diagnostic contract",
		);
		const buildJson = parseJson<{
			error: {
				code: string;
				details: { diagnostics: Array<{ path?: string; cause?: unknown }> };
			};
		}>(build, "build diagnostic failure");
		assert(
			buildJson.error.code === "CLI_BUILD_FAILED",
			`expected CLI_BUILD_FAILED, got ${buildJson.error.code}`,
		);
		const errorDiagnostic = buildJson.error.details.diagnostics.find(
			(diagnostic) => diagnostic.cause !== undefined,
		);
		assert(
			errorDiagnostic !== undefined,
			"build failure must include nested diagnostic cause",
		);
		assert(
			errorDiagnostic.path !== undefined,
			"build failure must include failing path",
		);

		const doctor = await runAtlas(
			["doctor", "--json", "--config", config, "--cwd", repo],
			{ env },
		);
		assert(
			doctor.exitCode === 0,
			`doctor failed: ${doctor.stderr}\n${doctor.stdout}`,
		);
		assertIncludes(doctor.stdout, "layer", "doctor JSON layer output");

		console.log("Production onboarding UAT passed.");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

await main();
