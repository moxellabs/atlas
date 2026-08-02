/// <reference types="bun" />

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  type CanonicalDocument,
  type CorpusChunk,
  createChunkId,
  createDocId,
  createSectionId,
} from "@atlas/core";
import {
  ChunkRepository,
  DocRepository,
  ManifestRepository,
  openStore,
  RepoRepository,
} from "@atlas/store";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { loadAgentEffectDataset } from "../../packages/eval/src/agent-effect/dataset";
import { traceMcpEvents } from "../../packages/eval/src/agent-effect/codex";
import { createAtlasMcpServer } from "../../packages/mcp/src/server/create-mcp-server";

const repoId = "github.com/justmrmendez/diffract";
const evidencePath = "docs/architecture/streaming-scene-session.md";
const query =
  "In Diffract/WaveBridge, which files make up a .wb.scene-session container, and exactly what repairs may recovery perform after an interrupted append?";
const cwd = process.cwd();

interface Check {
  readonly dimension:
    | "discovery"
    | "hermeticity"
    | "observability"
    | "grounding"
    | "prompt";
  readonly passed: boolean;
}

const dataset = await loadAgentEffectDataset(
  resolve(cwd, "evals/datasets/luna-agent-discovery-smoke.json"),
);
const codexSource = await readFile(
  resolve(cwd, "packages/eval/src/agent-effect/codex.ts"),
  "utf8",
);
const packageJson = JSON.parse(
  await readFile(resolve(cwd, "package.json"), "utf8"),
) as { scripts?: Record<string, string> };
const smokeCommand = packageJson.scripts?.["eval:luna:smoke"] ?? "";

const store = openStore({ path: ":memory:", migrate: true });
seedCorpus();
const atlasServer = createAtlasMcpServer({ db: store });
const client = new Client(
  { name: "atlas-autoresearch-benchmark", version: "1.0.0" },
  { capabilities: {} },
);
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

try {
  await Promise.all([
    atlasServer.server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const listed = await client.listTools();
  const sourceTool = listed.tools.find(
    (tool) => tool.name === "answer_diffract_docs",
  );
  const plan = await client.callTool({
    name: "answer_diffract_docs",
    arguments: { query },
  });
  const structured = asRecord(plan.structuredContent);
  const coverage = asRecord(structured?.coverage);
  const citations = Array.isArray(structured?.citations)
    ? structured.citations.map(asRecord).filter(isDefined)
    : [];
  const toolText =
    `${sourceTool?.title ?? ""} ${sourceTool?.description ?? ""}`.toLowerCase();
  const annotations = asRecord(sourceTool?.annotations);

  const trace = traceMcpEvents(traceFixture());
  const observedSources = new Set(
    trace.calls.map((event) => String(event.source)),
  );
  const observedKinds = new Set(trace.calls.map((event) => String(event.kind)));
  const task = dataset.tasks.find(
    (candidate) => candidate.id === "diffract-scene-session-recovery",
  );
  const prompt = task?.prompt ?? "";
  const promptLower = prompt.toLowerCase();
  const bannedPromptTerms = [
    "atlas",
    "mcp",
    "local documentation",
    "retrieval",
    "tool name",
    "plan_context",
  ];

  const checks: Check[] = [
    {
      dimension: "prompt",
      passed: prompt === query,
    },
    {
      dimension: "prompt",
      passed: bannedPromptTerms.every((term) => !promptLower.includes(term)),
    },
    {
      dimension: "prompt",
      passed:
        task?.criteria.map((criterion) => criterion.kind).join(",") ===
          "completion,grounding,citation" &&
        task.criteria.every(
          (criterion) =>
            criterion.evidencePaths.length === 1 &&
            criterion.evidencePaths[0] === evidencePath,
        ),
    },
    {
      dimension: "prompt",
      passed: dataset.runner.trialsPerTask >= 3,
    },
    {
      dimension: "discovery",
      passed: sourceTool !== undefined,
    },
    {
      dimension: "discovery",
      passed: ["diffract", "wavebridge", "scene", "session"].every((term) =>
        toolText.includes(term),
      ),
    },
    {
      dimension: "discovery",
      passed: ["container", "recovery", "append"].every((term) =>
        toolText.includes(term),
      ),
    },
    {
      dimension: "discovery",
      passed:
        annotations?.readOnlyHint === true &&
        annotations.openWorldHint === false,
    },
    {
      dimension: "discovery",
      passed: coverage?.status === "sufficient",
    },
    {
      dimension: "grounding",
      passed: structured?.nextAction === "answer_locally",
    },
    {
      dimension: "grounding",
      passed: citations.some(
        (citation) =>
          citation.repoId === repoId && citation.path === evidencePath,
      ),
    },
    {
      dimension: "grounding",
      passed:
        task?.criteria.some((criterion) => criterion.kind === "grounding") ===
          true &&
        task.criteria.some((criterion) => criterion.kind === "citation") ===
          true,
    },
    {
      dimension: "hermeticity",
      passed:
        codexSource.includes('"--ignore-user-config"') &&
        codexSource.includes('"--ignore-rules"'),
    },
    {
      dimension: "hermeticity",
      passed:
        codexSource.includes('"--disable"') &&
        codexSource.includes('"web_search"'),
    },
    {
      dimension: "hermeticity",
      passed:
        /\bHOME\b/.test(codexSource) &&
        /\bGITHUB_TOKEN\b/.test(codexSource) &&
        /\bGH_TOKEN\b/.test(codexSource) &&
        /Bun\.spawn\([^]*?env:/.test(codexSource),
    },
    {
      dimension: "hermeticity",
      passed:
        !smokeCommand.includes("--global") &&
        !smokeCommand.includes("--workspace"),
    },
    {
      dimension: "observability",
      passed:
        !codexSource.includes('input.arm === "treatment"\n\t\t\t\t? { mcp:') &&
        codexSource.includes("traceMcpEvents(result.stdout)"),
    },
    {
      dimension: "observability",
      passed: observedSources.has("atlas") && observedSources.has("web"),
    },
    {
      dimension: "observability",
      passed:
        observedSources.has("shell") &&
        observedSources.has("filesystem") &&
        observedSources.has("github"),
    },
    {
      dimension: "observability",
      passed:
        observedKinds.has("tool") &&
        observedKinds.has("web_search") &&
        observedKinds.has("command"),
    },
    {
      dimension: "observability",
      passed: trace.protocolErrors === 0,
    },
  ];

  const dimensionRates = Object.fromEntries(
    (
      [
        "discovery",
        "hermeticity",
        "observability",
        "grounding",
        "prompt",
      ] as const
    ).map((dimension) => {
      const selected = checks.filter((check) => check.dimension === dimension);
      return [
        dimension,
        selected.filter((check) => check.passed).length / selected.length,
      ];
    }),
  ) as Record<Check["dimension"], number>;
  const readiness =
    checks.filter((check) => check.passed).length / checks.length;

  console.log(`METRIC discovery_readiness=${fixed(readiness)}`);
  console.log(
    `METRIC autonomous_discovery_rate=${fixed(dimensionRates.discovery)}`,
  );
  console.log(`METRIC hermeticity_rate=${fixed(dimensionRates.hermeticity)}`);
  console.log(
    `METRIC observability_rate=${fixed(dimensionRates.observability)}`,
  );
  console.log(`METRIC grounding_rate=${fixed(dimensionRates.grounding)}`);
  console.log(`METRIC prompt_fidelity_rate=${fixed(dimensionRates.prompt)}`);
  console.log(
    `METRIC consecutive_treatment_trials=${dataset.runner.trialsPerTask}`,
  );
  console.log(
    `METRIC protocol_error_rate=${trace.protocolErrors === 0 ? 0 : 1}`,
  );
} finally {
  await Promise.allSettled([client.close(), atlasServer.server.close()]);
  store.close();
}

function seedCorpus(): void {
  const docId = createDocId({ repoId, path: evidencePath });
  const sectionId = createSectionId({
    docId,
    headingPath: [
      "Streaming scene-session container",
      "Interrupted append recovery",
    ],
    ordinal: 0,
  });
  const text =
    "WaveBridge and Diffract store each .wb.scene-session container as exactly scene-session-manifest.json, scene-frames.jsonl, and scene-index.bin. Recovery after an interrupted append may adopt at most one complete post-manifest journal record, reconstruct its one missing index row, truncate one incomplete final journal line or index row, and reconcile the manifest. It never rewrites prior complete rows and fails closed on longer uncommitted suffixes or unexpected state.";
  const document: CanonicalDocument = {
    docId,
    repoId,
    path: evidencePath,
    sourceVersion: "fixture-revision-1",
    title: "WaveBridge streaming scene-session container recovery",
    kind: "repo-doc",
    authority: "canonical",
    scopes: [{ level: "repo", repoId }],
    sections: [
      {
        sectionId,
        headingPath: [
          "Streaming scene-session container",
          "Interrupted append recovery",
        ],
        ordinal: 0,
        text,
        codeBlocks: [],
      },
    ],
    metadata: {
      tags: ["wavebridge", "scene-session", "container", "recovery", "append"],
    },
  };
  const chunk: CorpusChunk = {
    chunkId: createChunkId({ docId, sectionId, ordinal: 0 }),
    docId,
    repoId,
    kind: "repo-doc",
    authority: "canonical",
    headingPath: [
      "Streaming scene-session container",
      "Interrupted append recovery",
    ],
    ordinal: 0,
    text,
    tokenCount: 67,
  };

  new RepoRepository(store).upsert({
    repoId,
    mode: "local-git",
    revision: "fixture-revision-1",
  });
  new ManifestRepository(store).upsert({
    repoId,
    indexedRevision: "fixture-revision-1",
    compilerVersion: "autoresearch-fixture-1",
  });
  new DocRepository(store).replaceCanonicalDocument(document);
  new ChunkRepository(store).replaceForDocument(docId, [chunk]);
}

function traceFixture(): string {
  const events = [
    {
      type: "item.completed",
      item: {
        type: "mcp_tool_call",
        server: "atlas_eval",
        tool: "answer_diffract_docs",
        error: null,
      },
    },
    {
      type: "item.completed",
      item: { type: "web_search_call", query: "Diffract scene session" },
    },
    {
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "printf hermetic-smoke",
        exit_code: 0,
      },
    },
    {
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "cat docs/architecture/streaming-scene-session.md",
        exit_code: 0,
      },
    },
    {
      type: "item.completed",
      item: {
        type: "command_execution",
        command: "gh api repos/JustMrMendez/diffract",
        exit_code: 0,
      },
    },
  ];
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function fixed(value: number): string {
  return value.toFixed(6);
}
