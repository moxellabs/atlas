import { $ } from "bun";

const args = new Set(Bun.argv.slice(2));
const releaseReady =
	args.has("--release-ready") || args.has("--release-readiness");

async function run(label: string, command: Promise<unknown>): Promise<void> {
	console.log(`\n▶ ${label}`);
	await command;
}

await run("typecheck", $`bun run typecheck`);
await run("lint", $`bun run lint`);
await run("test", $`bun test`);
await run(
	"public artifact guard",
	$`bun tooling/scripts/public-artifact-guard.ts`,
);

if (releaseReady) {
	await run(
		"public artifact freshness",
		$`bun apps/cli/src/index.ts artifact verify --fresh`,
	);
	await run("distribution smoke", $`bun tooling/scripts/distribution-smoke.ts`);
}

console.log(
	releaseReady
		? "\nRelease readiness verification passed."
		: "\nWorkspace verification passed.",
);
