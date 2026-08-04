import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadServerEnv } from "../env";
import { createResolvedConfig, repoId } from "../server.test-fixtures";
import {
  buildServerDependencies,
  closeServerDependencies,
} from "./dependencies";

describe("server dependency lifecycle", () => {
  test("replaces and closes lifecycle services on config reload and shutdown", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-server-lifecycle-test-"));
    const dependencies = await buildServerDependencies(
      loadServerEnv({ ATLAS_ENABLE_MCP: "false" }),
      createResolvedConfig(
        join(root, "atlas.db"),
        join(root, "atlas.config.json"),
      ),
    );
    let closed = false;

    try {
      const initialLifecycle = dependencies.lifecycle;
      expect(initialLifecycle).toBeDefined();

      dependencies.reloadConfig?.(
        createResolvedConfig(
          join(root, "atlas.db"),
          join(root, "atlas.config.json"),
        ),
      );

      expect(dependencies.lifecycle).toBeDefined();
      expect(dependencies.lifecycle).not.toBe(initialLifecycle);
      expect(await initialLifecycle?.refreshRepository(repoId)).toBeUndefined();

      const activeLifecycle = dependencies.lifecycle;
      await closeServerDependencies(dependencies);
      closed = true;
      expect(await activeLifecycle?.refreshRepository(repoId)).toBeUndefined();
    } finally {
      if (!closed) await closeServerDependencies(dependencies);
      await rm(root, { recursive: true, force: true });
    }
  });
});
