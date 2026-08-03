import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModuleId, createPackageId } from "@atlas/core";

import {
  type AtlasStoreClient,
  ModuleRepository,
  openStore,
  PackageRepository,
  RepoRepository,
} from "./index";

export const repoId = "atlas";
export const packageId = createPackageId({ repoId, path: "packages/auth" });
export const moduleId = createModuleId({
  repoId,
  packageId,
  path: "packages/auth/src/session",
});

export interface StoreFixture {
  dbPath: string;
  rootPath: string;
  store: AtlasStoreClient;
}

export async function createStoreFixture(): Promise<StoreFixture> {
  const rootPath = await mkdtemp(join(tmpdir(), "atlas-store-test-"));
  const dbPath = join(rootPath, "atlas.db");
  let store: AtlasStoreClient | undefined;

  try {
    store = openStore({ path: dbPath, migrate: true });
    return { dbPath, rootPath, store };
  } catch (error) {
    const cleanupErrors = await cleanupStoreFixtureResources(store, rootPath);
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Failed to initialize store test fixture.",
      );
    }
    throw error;
  }
}

export async function closeStoreFixture(
  fixture: StoreFixture | undefined,
): Promise<void> {
  if (!fixture) {
    return;
  }

  const errors = await cleanupStoreFixtureResources(
    fixture.store,
    fixture.rootPath,
  );
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, "Failed to close store test fixture.");
  }
}

async function cleanupStoreFixtureResources(
  store: AtlasStoreClient | undefined,
  rootPath: string,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  if (store !== undefined) {
    try {
      store.close();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await rm(rootPath, { recursive: true, force: true });
  } catch (error) {
    errors.push(error);
  }
  return errors;
}

export function seedStructuralStore(store: AtlasStoreClient): void {
  new RepoRepository(store).upsert({
    repoId,
    mode: "local-git",
    revision: "rev_1",
  });
  new PackageRepository(store).upsert({
    packageId,
    repoId,
    name: "@atlas/auth",
    path: "packages/auth",
    manifestPath: "packages/auth/package.json",
  });
  new ModuleRepository(store).upsert({
    moduleId,
    repoId,
    packageId,
    name: "session",
    path: "packages/auth/src/session",
  });
}
