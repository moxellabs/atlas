import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { classifyQuery } from "../classify/classify-query";
import {
  createSeededRetrievalFixture,
  repoId,
  sessionModuleId,
  sessionSkillId,
  type SeededRetrievalFixture,
} from "../retrieval.test-fixtures";
import { inferScopes } from "./infer-scopes";

describe("inferScopes", () => {
  let fixture: SeededRetrievalFixture | undefined;

  beforeEach(async () => {
    fixture = await createSeededRetrievalFixture();
  });

  afterEach(async () => {
    await fixture?.dispose();
    fixture = undefined;
  });

  test("infers scored package, module, and skill scopes from store metadata", () => {
    const classification = classifyQuery("use the session skill in auth");
    const result = inferScopes({
      store: fixture!.retrievalStore,
      query: "use the session skill in auth",
      classification,
      repoId,
    });

    expect(result.scopes[0]).toMatchObject({
      level: "skill",
      id: sessionSkillId,
    });
    expect(
      result.scopes.some(
        (scope) => scope.level === "module" && scope.id === sessionModuleId,
      ),
    ).toBe(true);
    const inferredModule = result.scopes.find(
      (scope) => scope.level === "module" && scope.id === sessionModuleId,
    );
    expect(inferredModule?.score).toBeLessThan(0.62);
    expect(result.diagnostics[0]).toMatchObject({ stage: "scope-inference" });
  });
});
