import { chmod, mkdir, rm } from "node:fs/promises";

const distDir = "dist";
const binDir = "bin";
const bundles = [
	{ entry: "apps/cli/src/index.ts", output: "dist/atlas.js", name: "atlas" },
	{
		entry: "apps/cli/src/commander.ts",
		output: "dist/commander.js",
		name: "commander",
	},
] as const;

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

for (const bundle of bundles) {
	const build = await Bun.build({
		entrypoints: [bundle.entry],
		outdir: distDir,
		target: "bun",
		format: "esm",
		naming: `${bundle.name}.js`,
		splitting: false,
		packages: "bundle",
		env: "disable",
		sourcemap: "none",
		minify: {
			whitespace: true,
			syntax: true,
			identifiers: false,
		},
	});

	if (!build.success) {
		throw new Error(`Failed to build Atlas package bundle: ${bundle.name}.`);
	}
	if (build.logs.length > 0) {
		console.warn(
			`Atlas package build completed with messages for ${bundle.name}:`,
		);
		for (const log of build.logs) console.warn(log);
	}
	if (!(await Bun.file(bundle.output).exists())) {
		throw new Error(`Expected package bundle missing: ${bundle.output}`);
	}
}

await Bun.write(
	"dist/schema.sql",
	Bun.file("packages/store/src/db/schema.sql"),
);
await mkdir(binDir, { recursive: true });
await Bun.write(
	"bin/atlas",
	"#!/usr/bin/env bun\nimport '../dist/atlas.js';\n",
);
await chmod("bin/atlas", 0o755);

console.log("Built package distribution files in dist/ and bin/.");
