import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  createSeededRetrievalFixture,
  repoDocId,
  repoId,
  type SeededRetrievalFixture,
} from "../retrieval.test-fixtures";
import { planContext } from "../planner/plan-context";
import { expandQuery } from "./expand-query";

describe("expandQuery", () => {
  let fixture: SeededRetrievalFixture | undefined;

  beforeEach(async () => {
    fixture = await createSeededRetrievalFixture();
  });

  afterEach(async () => {
    await fixture?.dispose();
    fixture = undefined;
  });

  test("expands Atlas query vocabulary for lexical candidate generation", () => {
    expect(expandQuery("How do I publish artifacts?")).toContain(
      ".moxel/atlas",
    );
    expect(expandQuery("How does MCP work?")).toContain(
      "model context protocol",
    );
    expect(expandQuery("Explain packages/mcp boundaries")).toContain(
      "packages/mcp/docs/index.md",
    );
    expect(expandQuery("default MCP server identity override knobs")).toContain(
      "ATLAS_MCP_NAME",
    );
    expect(expandQuery("repo import without checkout")).toContain("repo add");
    expect(
      expandQuery(
        "I set up a repository and want another agent to use the knowledge from it",
      ),
    ).toContain("docs/self-indexing.md");
    expect(expandQuery("inspect corpus search")).toContain("SQLite");
    expect(expandQuery("atlas build --profile public")).toContain(
      "docs/ingestion-build-flow.md",
    );
    expect(expandQuery("repo show target inference")).toContain(
      "apps/cli/docs/index.md",
    );
    expect(expandQuery("security credentials tokens local-first")).toContain(
      "docs/security.md",
    );
    expect(expandQuery("private profile metadata precedence")).toContain(
      "docs/configuration.md",
    );
    expect(expandQuery("configure Atlas scopes")).toContain(
      "docs/runtime-surfaces.md",
    );
    const fallbackQuery = expandQuery(
      "prefer-local behavior for absent, partial, or stale coverage",
    );
    expect(fallbackQuery).not.toContain("docs/runtime-surfaces.md");
    expect(fallbackQuery).toContain(
      "absent partial stale local indexed coverage",
    );
    expect(fallbackQuery).not.toContain("covered-query-first");
    expect(fallbackQuery).not.toContain("model context protocol");
    expect(fallbackQuery).not.toContain("docs/retrieval-and-context.md");
    expect(fallbackQuery).not.toContain("behavior for");
    expect(
      expandQuery("covered-query-first initialization guidance"),
    ).toContain("atlas agent install");
    expect(expandQuery("generated vendor directories ignored")).toContain(
      "docs/troubleshooting.md",
    );
    expect(expandQuery("stale indexed coverage")).not.toContain(
      "docs/troubleshooting.md",
    );
    expect(expandQuery("generated test coverage artifacts")).toContain(
      "docs/troubleshooting.md",
    );
    expect(
      expandQuery("retrival contxt planing token budjet omissions diagnostics"),
    ).toContain("docs/retrieval-and-context.md");

    const plan = planContext({
      store: fixture!.retrievalStore,
      repoId,
      query: "How do I publish artifacts?",
      budgetTokens: 220,
    });

    expect(
      plan.rankedHits.some((hit) => hit.provenance.docId === repoDocId),
    ).toBe(true);
  });
});
