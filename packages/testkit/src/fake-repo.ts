import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface FakeRepoFile {
	path: string;
	content: string;
}

export interface FakeRepoInput {
	rootPath: string;
	files?: FakeRepoFile[] | undefined;
	commit?: boolean | undefined;
}

export interface FakeRepoResult {
	rootPath: string;
	files: FakeRepoFile[];
	revision?: string | undefined;
}

export interface ProductionLikeFakeRepoOptions {
	includeIgnoredBrokenDocs?: boolean | undefined;
}

export const defaultFakeRepoFiles: FakeRepoFile[] = [
	{
		path: "docs/index.md",
		content: "# Index\n\nRepository docs for session operations.\n",
	},
	{
		path: "packages/auth/package.json",
		content: `${JSON.stringify({ name: "@atlas/auth" }, null, 2)}\n`,
	},
	{
		path: "packages/auth/docs/session.md",
		content:
			"# Session\n\n## Rotation\n\nRotate session tokens during renewal.\n",
	},
	{
		path: "Auth/docs/auth-skill/skill.md",
		content: "# Auth Skill\n\nUse this skill for session token operations.\n",
	},
];

/** Production-shaped monorepo fixture used for live-topology/build-boundary regressions. */
export function productionLikeFakeRepoFiles(
	options: ProductionLikeFakeRepoOptions = {},
): FakeRepoFile[] {
	return [
		{
			path: "README.md",
			content: "# Production Repo\n\nPublic entrypoint docs.\n",
		},
		{
			path: "docs/index.md",
			content: "# Index\n\nRepository docs for production onboarding.\n",
		},
		{
			path: "docs/runbooks/release.md",
			content: "# Release Runbook\n\nRelease steps and rollback notes.\n",
		},
		{
			path: "apps/web/package.json",
			content: `${JSON.stringify({ name: "@prod/web" }, null, 2)}\n`,
		},
		{
			path: "apps/web/docs/index.md",
			content: "# Web App\n\nConsumer-facing web app docs.\n",
		},
		{
			path: "packages/auth/package.json",
			content: `${JSON.stringify({ name: "@prod/auth" }, null, 2)}\n`,
		},
		{
			path: "packages/auth/docs/session.md",
			content: "# Session\n\nSession lifecycle docs.\n",
		},
		{
			path: "packages/auth/src/policies/docs/passwords.md",
			content: "# Password Policies\n\nModule-level password docs.\n",
		},
		{
			path: "skills/document-codebase/SKILL.md",
			content:
				"---\ndescription: Update codebase docs safely.\n---\n# Document Codebase\n\nUse this skill to update repo docs.\n",
		},
		{
			path: "packages/auth/src/index.ts",
			content: "export const auth = true;\n",
		},
		{ path: "dist/generated.txt", content: "generated output\n" },
		...(options.includeIgnoredBrokenDocs === true
			? [
					{
						path: "node_modules/bad-package/SKILL.md",
						content:
							"---\ndescription: broken\n# Missing closing frontmatter\n",
					},
					{
						path: ".moxel/atlas/SKILL.md",
						content:
							"---\ndescription: generated broken\n# Missing closing frontmatter\n",
					},
				]
			: []),
	];
}

/** Creates a deterministic fake repository tree, optionally initialized as a Git repo. */
export async function createFakeRepo(
	input: FakeRepoInput,
): Promise<FakeRepoResult> {
	const files = input.files ?? defaultFakeRepoFiles;
	await mkdir(input.rootPath, { recursive: true });
	for (const file of files) {
		const fullPath = join(input.rootPath, file.path);
		await mkdir(dirname(fullPath), { recursive: true });
		await writeFile(fullPath, file.content);
	}
	if (input.commit !== true) {
		return { rootPath: input.rootPath, files };
	}

	await git(input.rootPath, ["init", "-b", "main"]);
	await git(input.rootPath, ["config", "user.email", "atlas@example.test"]);
	await git(input.rootPath, ["config", "user.name", "ATLAS Test"]);
	await git(input.rootPath, ["add", "."]);
	await git(input.rootPath, ["commit", "-m", "initial"]);
	const revision = await git(input.rootPath, ["rev-parse", "HEAD"]);
	return { rootPath: input.rootPath, files, revision: revision.trim() };
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
	const process = Bun.spawn(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	const exitCode = await process.exited;
	const stdout = await new Response(process.stdout).text();
	if (exitCode === 0) {
		return stdout;
	}
	const stderr = await new Response(process.stderr).text();
	throw new Error(
		stderr.trim() || `git ${args.join(" ")} failed with exit code ${exitCode}.`,
	);
}
