import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { CliPrompts } from "../io/prompts";
import type { CliCommandContext } from "../runtime/types";
import { git } from "../cli.test-helpers";
import { resolveRepoConfigInput } from "./shared";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("resolveRepoConfigInput", () => {
	test.each([
		["HTTPS", "https://github.com/MoxelLabs/Atlas.git"],
		["SCP", "git@github.com:MoxelLabs/Atlas.git"],
		["SSH", "ssh://git@github.com/MoxelLabs/Atlas.git"],
	])("uses the %s origin as an editable local-git Repository ID fallback", async (_kind, remote) => {
		const root = await createGitCheckout(remote);
		const prompts = promptRecorder({ "Repository ID": "github.com/example/edited" });

		const repo = await resolveRepoConfigInput(
			commandContext(root),
			input(),
			{ prompts: prompts.adapter },
		);

		expect(repo.repoId).toBe("github.com/example/edited");
		expect(prompts.inputs).toContainEqual({
			question: "Repository ID",
			fallback: "github.com/moxellabs/atlas",
		});
	});

	test("prefers an explicit repository ID over the inferred origin", async () => {
		const root = await createGitCheckout("https://github.com/MoxelLabs/Atlas.git");
		const prompts = promptRecorder();

		const repo = await resolveRepoConfigInput(
			commandContext(root),
			{ ...input(), repoId: "github.com/example/override" },
			{ prompts: prompts.adapter },
		);

		expect(repo.repoId).toBe("github.com/example/override");
		expect(prompts.inputs.map(({ question }) => question)).not.toContain("Repository ID");
	});

	test("uses a format-helpful Repository ID prompt when origin has no parseable default", async () => {
		const root = await createGitCheckout();
		const prompts = promptRecorder({
			"Repository ID (host/owner/name, e.g. github.com/owner/repo)": "github.com/example/manual",
		});

		const repo = await resolveRepoConfigInput(
			commandContext(root),
			input(),
			{ prompts: prompts.adapter },
		);

		expect(repo.repoId).toBe("github.com/example/manual");
		expect(prompts.inputs).toContainEqual({
			question: "Repository ID (host/owner/name, e.g. github.com/owner/repo)",
			fallback: undefined,
		});
	});

	test("keeps a blank defaultless Repository ID as CLI_REPO_ID_REQUIRED", async () => {
		const root = await createGitCheckout();
		const prompts = promptRecorder();

		await expect(
			resolveRepoConfigInput(commandContext(root), input(), { prompts: prompts.adapter }),
		).rejects.toMatchObject({ code: "CLI_REPO_ID_REQUIRED" });
		expect(prompts.inputs).toContainEqual({
			question: "Repository ID (host/owner/name, e.g. github.com/owner/repo)",
			fallback: undefined,
		});
	});

	test("does not infer a local-git origin for GHES mode", async () => {
		const root = await createGitCheckout("https://github.com/MoxelLabs/Atlas.git");
		const prompts = promptRecorder({
			"Repository ID (host/owner/name, e.g. github.com/owner/repo)": "github.example/platform/docs",
			"GHES API base URL": "https://github.example/api/v3",
			"GHES owner": "platform",
			"GHES repository name": "docs",
		});

		const repo = await resolveRepoConfigInput(
			commandContext(root),
			{ ...input(), mode: "ghes-api" },
			{ prompts: prompts.adapter },
		);

		expect(repo).toMatchObject({ repoId: "github.example/platform/docs", mode: "ghes-api" });
		expect(prompts.inputs).toContainEqual({
			question: "Repository ID (host/owner/name, e.g. github.com/owner/repo)",
			fallback: undefined,
		});
	});
});

function input() {
	return {
		cacheDir: ".atlas",
		packageGlobs: [],
		packageManifestFiles: [],
		nonInteractive: false,
	};
}

function commandContext(cwd: string): CliCommandContext {
	const stdin = new PassThrough() as unknown as NodeJS.ReadStream;
	const stdout = new PassThrough() as unknown as NodeJS.WriteStream;
	Object.assign(stdin, { isTTY: true });
	Object.assign(stdout, { isTTY: true });
	return {
		argv: [],
		cwd,
		output: { json: false, verbose: false, quiet: false },
		stdin,
		stdout,
		stderr: new PassThrough() as unknown as NodeJS.WriteStream,
		env: {},
	};
}

function promptRecorder(answers: Record<string, string> = {}) {
	const inputs: Array<{ question: string; fallback: string | undefined }> = [];
	const adapter: CliPrompts = {
		intro() {},
		outro() {},
		async input(question, fallback) {
			inputs.push({ question, fallback });
			return answers[question] ?? fallback ?? "";
		},
		async confirm() { return false; },
		async select() { return "local-git"; },
		spinner() { return { start() {}, stop() {} }; },
	};
	return { adapter, inputs };
}

async function createGitCheckout(remote?: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "atlas-shared-test-"));
	roots.push(root);
	await git(root, ["init", "--initial-branch=main"]);
	if (remote !== undefined) await git(root, ["remote", "add", "origin", remote]);
	return root;
}
