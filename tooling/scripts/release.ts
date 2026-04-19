import { $ } from "bun";

const args = new Set(Bun.argv.slice(2));
const dryRun = args.has("--dry-run") || args.has("--check");
const channelOnly = args.has("--channel");
const tagArg = Bun.argv.find((arg) => arg.startsWith("--tag="));
const explicitTag = tagArg?.slice("--tag=".length);
const envTag =
	process.env.GITHUB_REF_NAME ||
	process.env.GITHUB_REF?.replace(/^refs\/tags\//, "");
const tag = explicitTag || envTag;

const stableTagPattern = /^v(\d+)\.(\d+)\.(\d+)$/;
const prereleaseTagPattern =
	/^v(\d+)\.(\d+)\.(\d+)-([0-9A-Za-z][0-9A-Za-z.-]*)$/;

export interface ReleaseChannel {
	readonly version: string;
	readonly npmDistTag: "latest" | "next";
	readonly prerelease: boolean;
}

export function resolveReleaseChannel(releaseTag: string): ReleaseChannel {
	const stable = stableTagPattern.exec(releaseTag);
	if (stable) {
		return {
			version: `${stable[1]}.${stable[2]}.${stable[3]}`,
			npmDistTag: "latest",
			prerelease: false,
		};
	}
	const prerelease = prereleaseTagPattern.exec(releaseTag);
	if (prerelease) {
		return {
			version: `${prerelease[1]}.${prerelease[2]}.${prerelease[3]}-${prerelease[4]}`,
			npmDistTag: "next",
			prerelease: true,
		};
	}
	throw new Error(
		`Invalid release tag: ${releaseTag}. Expected vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-prerelease.`,
	);
}

async function assertPackageVersion(version: string): Promise<void> {
	const pkg = await Bun.file("package.json").json();
	if (pkg.name !== "@moxellabs/atlas") {
		throw new Error(`package name must be @moxellabs/atlas, got ${pkg.name}`);
	}
	if (pkg.version !== version) {
		throw new Error(
			`tag/package version mismatch: tag expects ${version}, package.json has ${pkg.version}`,
		);
	}
	if (pkg.private === true) {
		throw new Error("@moxellabs/atlas package must not be private");
	}
	if (pkg.publishConfig?.access !== "public") {
		throw new Error("@moxellabs/atlas publishConfig.access must be public");
	}
}

if (!dryRun && !channelOnly) {
	throw new Error(
		"Atlas release script is local-first only. Pass --dry-run/--check for verification or --channel for tag metadata; publishing happens only in GitHub Actions workflow.",
	);
}

if (tag) {
	const channel = resolveReleaseChannel(tag);
	await assertPackageVersion(channel.version);
	console.log(`VERSION=${channel.version}`);
	console.log(`NPM_DIST_TAG=${channel.npmDistTag}`);
	console.log(`GITHUB_PRERELEASE=${channel.prerelease}`);
	if (channelOnly) process.exit(0);
} else if (channelOnly) {
	throw new Error(
		"--channel requires --tag=<vMAJOR.MINOR.PATCH[-prerelease]> or GITHUB_REF_NAME",
	);
}

console.log(
	"Atlas release dry-run: local verification only; no registry publish will occur.",
);
await $`bun tooling/scripts/verify.ts --release-ready`;
console.log("Atlas release dry-run passed.");
