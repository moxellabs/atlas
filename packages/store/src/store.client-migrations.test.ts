import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type AtlasStoreClient,
  getCurrentSchemaVersion,
  getStoreDiagnostics,
  migrateStore,
  openStore,
  SkillRepository,
  STORE_SCHEMA_VERSION,
} from "./index";
import {
  closeStoreFixture,
  createStoreFixture,
  type StoreFixture,
} from "./store.test-fixtures";

describe("store client and migrations", () => {
  let fixture: StoreFixture | undefined;

  beforeEach(async () => {
    fixture = await createStoreFixture();
  });

  afterEach(async () => {
    await closeStoreFixture(fixture);
    fixture = undefined;
  });

  test("initializes and reruns migrations idempotently", () => {
    const { dbPath, store } = fixture!;

    expect(getCurrentSchemaVersion(store)).toBe(STORE_SCHEMA_VERSION);
    expect(() =>
      openStore({ path: dbPath, migrate: true }).close(),
    ).not.toThrow();
  });

  test("creates missing parent directories for file-backed stores", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "atlas-store-parent-test-"));
    const nestedDbPath = join(rootPath, "nested", "corpus", "atlas.db");
    let nestedStore: AtlasStoreClient | undefined;

    try {
      nestedStore = openStore({ path: nestedDbPath, migrate: true });
      nestedStore.close();
      nestedStore = undefined;

      expect((await stat(nestedDbPath)).isFile()).toBe(true);
    } finally {
      try {
        nestedStore?.close();
      } finally {
        await rm(rootPath, { recursive: true, force: true });
      }
    }
  });

  test("read-only open never creates a missing corpus path", async () => {
    const rootPath = await mkdtemp(join(tmpdir(), "atlas-store-read-only-"));
    const nestedDbPath = join(rootPath, "nested", "corpus", "atlas.db");

    try {
      expect(() => openStore({ path: nestedDbPath, readOnly: true })).toThrow();
      await expect(stat(join(rootPath, "nested"))).rejects.toThrow();
    } finally {
      await rm(rootPath, { recursive: true, force: true });
    }
  });

  test("rejects migrations on a read-only store", () => {
    const { dbPath } = fixture!;

    expect(() =>
      openStore({ path: dbPath, readOnly: true, migrate: true }),
    ).toThrow("Read-only stores cannot run migrations.");
  });

  test("opens existing stores for read-only diagnostics", () => {
    const { dbPath } = fixture!;
    const readOnlyStore = openStore({ path: dbPath, readOnly: true });
    try {
      expect(getStoreDiagnostics(readOnlyStore).documentCount).toBe(0);
    } finally {
      readOnlyStore.close();
    }
  });

  test("repairs unreleased v1 dev stores with missing baseline tables", async () => {
    const rootPath = await mkdtemp(
      join(tmpdir(), "atlas-store-hard-cut-test-"),
    );
    const legacyDbPath = join(rootPath, "atlas.db");
    let legacyStore: AtlasStoreClient | undefined;

    try {
      legacyStore = openStore({ path: legacyDbPath, migrate: false });
      legacyStore.run(`
        CREATE TABLE schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        )
      `);
      legacyStore.run(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, 'baseline_store_schema', '2026-01-01T00:00:00.000Z')",
      );

      expect(() =>
        new SkillRepository(legacyStore!).listArtifacts("missing_skill"),
      ).toThrow();

      migrateStore(legacyStore!);

      expect(getCurrentSchemaVersion(legacyStore)).toBe(STORE_SCHEMA_VERSION);
      expect(
        new SkillRepository(legacyStore).listArtifacts("missing_skill"),
      ).toEqual([]);
    } finally {
      try {
        legacyStore?.close();
      } finally {
        await rm(rootPath, { recursive: true, force: true });
      }
    }
  });
});
