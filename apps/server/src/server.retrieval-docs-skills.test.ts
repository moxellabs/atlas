import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { executeFindScopes } from "@atlas/mcp";
import { createRetrievalStore } from "@atlas/retrieval";

import {
  createServerTestFixture,
  docId,
  json,
  moduleId,
  packageId,
  postJson,
  repoId,
  response,
  sectionId,
  skillId,
  type ServerTestFixture,
} from "./server.test-fixtures";

describe("server retrieval docs and skills", () => {
  let fixture: ServerTestFixture;
  let store: ServerTestFixture["store"];
  let app: ServerTestFixture["app"];

  beforeEach(async () => {
    fixture = await createServerTestFixture();
    ({ store, app } = fixture);
  });

  afterEach(async () => {
    await fixture.destroy();
  });

  test("serves search, scope, context, and retrieval inspect routes", async () => {
    expect(
      await postJson(app, "/api/search/scopes", {
        query: "session rotation",
        repoId,
      }),
    ).toMatchObject({
      data: {
        scopes: expect.arrayContaining([
          expect.objectContaining({ id: moduleId }),
        ]),
      },
    });
    const filteredScopesInput = {
      query: "session rotation",
      repoId,
      visibility: ["internal" as const],
    };
    const mcpScopes = executeFindScopes(filteredScopesInput, {
      db: store,
      retrievalStore: createRetrievalStore(store),
    });
    expect(
      await postJson(app, "/api/search/scopes", filteredScopesInput),
    ).toMatchObject({ data: mcpScopes });
    expect(
      await postJson(app, "/api/search/docs", {
        query: "session rotation",
        repoId,
      }),
    ).toMatchObject({
      data: {
        hits: expect.arrayContaining([
          expect.objectContaining({
            provenance: expect.objectContaining({ docId }),
          }),
        ]),
      },
    });
    expect(
      await postJson(app, "/api/context/plan", {
        query: "how do I rotate session tokens?",
        repoId,
        budgetTokens: 200,
      }),
    ).toMatchObject({
      data: { selected: expect.any(Array), confidence: expect.any(String) },
    });
    expect(
      await json(
        app,
        `/api/inspect/retrieval?query=${encodeURIComponent("session rotation")}&repoId=${repoId}`,
      ),
    ).toMatchObject({
      data: {
        classification: expect.any(Object),
        rankedHits: expect.any(Array),
      },
    });
  });

  test("serves direct document outline and section reads", async () => {
    expect(await json(app, `/api/docs/${docId}/outline`)).toMatchObject({
      data: {
        document: expect.objectContaining({
          docId,
          title: "Session",
          path: "packages/auth/docs/session.md",
        }),
        outline: [
          expect.objectContaining({
            sectionId,
            headingPath: ["Session", "Rotation"],
            ordinal: 0,
            preview:
              "Rotate session tokens by calling rotateSessionToken during renewal.",
          }),
        ],
        summaries: [
          expect.objectContaining({ targetId: docId, level: "short" }),
        ],
      },
    });

    expect(
      await json(app, `/api/docs/${docId}/sections/${sectionId}`),
    ).toMatchObject({
      data: {
        section: expect.objectContaining({
          sectionId,
          docId,
          headingPath: ["Session", "Rotation"],
          text: "Rotate session tokens by calling rotateSessionToken during renewal.",
          codeBlocks: [{ lang: "ts", code: "rotateSessionToken(sessionId);" }],
        }),
        provenance: expect.objectContaining({
          docId,
          repoId,
          packageId,
          moduleId,
          path: "packages/auth/docs/session.md",
          headingPath: ["Session", "Rotation"],
        }),
      },
    });

    expect(
      await json(
        app,
        `/api/docs/${docId}/section?heading=Session&heading=Rotation`,
      ),
    ).toMatchObject({
      data: {
        section: expect.objectContaining({ sectionId }),
        provenance: expect.objectContaining({
          headingPath: ["Session", "Rotation"],
        }),
      },
    });
  });

  test("maps document read validation and not-found errors through the shared envelope", async () => {
    const emptyHeading = await response(
      app,
      `/api/docs/${docId}/section?heading=`,
    );
    expect(emptyHeading.status).toBe(400);
    expect(await emptyHeading.json()).toMatchObject({
      ok: false,
      error: { code: "validation_failed" },
    });

    const missingDocument = await response(app, "/api/docs/missing/outline");
    expect(missingDocument.status).toBe(404);
    expect(await missingDocument.json()).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });

    const missingSection = await response(
      app,
      `/api/docs/${docId}/sections/missing`,
    );
    expect(missingSection.status).toBe(404);
    expect(await missingSection.json()).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });

  test("serves generated skill list and detail routes", async () => {
    expect(await json(app, `/api/skills?repoId=${repoId}`)).toMatchObject({
      data: [expect.objectContaining({ skillId })],
    });
    expect(await json(app, `/api/skills/${skillId}`)).toMatchObject({
      data: {
        skill: expect.objectContaining({ skillId }),
        sourceDocument: expect.objectContaining({ docId }),
      },
    });
  });

  test("maps validation and not-found errors through the shared envelope", async () => {
    const validation = await response(app, "/api/search/scopes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "" }),
    });
    expect(validation.status).toBe(400);
    expect(await validation.json()).toMatchObject({
      ok: false,
      error: { code: "validation_failed" },
    });

    const contentLengthTooLarge = await response(app, "/api/search/scopes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(1024 * 1024 + 1),
      },
      body: JSON.stringify({ query: "session rotation" }),
    });
    expect(contentLengthTooLarge.status).toBe(413);
    expect(await contentLengthTooLarge.json()).toMatchObject({
      ok: false,
      error: {
        code: "payload_too_large",
        details: { maxBytes: 1024 * 1024, actualBytes: 1024 * 1024 + 1 },
      },
    });

    const bodyTooLarge = await response(app, "/api/search/scopes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "x".repeat(1024 * 1024) }),
    });
    expect(bodyTooLarge.status).toBe(413);
    expect(await bodyTooLarge.json()).toMatchObject({
      ok: false,
      error: { code: "payload_too_large", details: { maxBytes: 1024 * 1024 } },
    });

    const missing = await response(app, "/api/skills/missing");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });
});
