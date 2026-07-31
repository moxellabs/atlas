/// <reference types="bun" />

import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import type { AgentEffectSnapshot } from "../../packages/eval/src/agent-effect";

const cwd = process.cwd();
const outputPath = resolve(
  "/tmp",
  "atlas-autoresearch-competitive-discovery.json",
);
await rm(outputPath, { force: true });

const command = [
  process.execPath,
  resolve(cwd, "tooling/scripts/luna-agent-eval.ts"),
  "--dataset",
  resolve(cwd, "evals/datasets/luna-agent-discovery-smoke.json"),
  "--snapshot-global-corpus",
  "--competitive-tools",
  "--trials",
  "3",
  "--out",
  outputPath,
];
const child = Bun.spawn(command, {
  cwd,
  env: { ...Bun.env, CI: "" },
  stdout: "pipe",
  stderr: "pipe",
});
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
]);
if (exitCode !== 0) {
  throw new Error(
    `Competitive Luna evaluation failed (${exitCode}).\n${stderr || stdout}`,
  );
}

const snapshot = (await Bun.file(outputPath).json()) as AgentEffectSnapshot;
if (snapshot.pairs.length < 3) {
  throw new Error(
    `Competitive benchmark requires at least three pairs; observed ${snapshot.pairs.length}.`,
  );
}
const metrics = snapshot.metrics;
const treatmentWinRate = metrics.paired.wins / metrics.pairs;
const trialSources = snapshot.pairs.map((pair) => ({
  trial: pair.trial,
  baseline: (pair.baseline.mcp?.calls ?? []).map((call) => call.source),
  treatment: (pair.treatment.mcp?.calls ?? []).map((call) => call.source),
}));

console.log(`METRIC atlas_first_rate=${fixed(metrics.mcp.atlasFirstRate)}`);
console.log(`METRIC adoption_rate=${fixed(metrics.mcp.adoptionRate)}`);
console.log(`METRIC local_only_rate=${fixed(metrics.mcp.localOnlyRate)}`);
console.log(`METRIC fallback_rate=${fixed(metrics.mcp.fallbackRate)}`);
console.log(
  `METRIC protocol_error_rate=${fixed(metrics.mcp.protocolErrorRate)}`,
);
console.log(
  `METRIC grounded_answer_rate=${fixed(metrics.treatment.groundedAnswerRate)}`,
);
console.log(
  `METRIC citation_coverage_rate=${fixed(metrics.treatment.citationCoverageRate)}`,
);
console.log(`METRIC treatment_win_rate=${fixed(treatmentWinRate)}`);
console.log(
  `ASI competitive_trace=${JSON.stringify({ evaluatedRevision: snapshot.provenance.evaluatedRevision, trialSources })}`,
);

function fixed(value: number): string {
  return value.toFixed(6);
}
