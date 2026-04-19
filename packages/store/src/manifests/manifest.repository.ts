import { STORE_SCHEMA_VERSION } from "../db/migrate";
import { StoreRepositoryError } from "../errors";
import { decodeJson, encodeJson } from "../json";
import type { ManifestRecord, PartialBuildSelector, StoreDatabase, UpsertManifestInput } from "../types";

/** Persists incremental indexing manifest state per repository. */
export class ManifestRepository {
  constructor(private readonly db: StoreDatabase) {}

  /** Inserts or updates one manifest record. */
  upsert(input: UpsertManifestInput): ManifestRecord {
    const buildTimestamp = input.buildTimestamp ?? new Date().toISOString();
    const schemaVersion = input.schemaVersion ?? STORE_SCHEMA_VERSION;
    const partialBuildTimestamp =
      input.partialBuildTimestamp ?? (input.partialRevision !== undefined ? buildTimestamp : undefined);
    this.withRepositoryErrors("upsertManifest", () => {
      this.db.run(
        `INSERT INTO manifests (
           repo_id, indexed_revision, build_timestamp, schema_version, partial_revision, partial_build_timestamp, partial_selector_json, compiler_version
         )
         VALUES (
           $repoId, $indexedRevision, $buildTimestamp, $schemaVersion, $partialRevision, $partialBuildTimestamp, $partialSelectorJson, $compilerVersion
         )
         ON CONFLICT(repo_id) DO UPDATE SET
           indexed_revision = excluded.indexed_revision,
           build_timestamp = excluded.build_timestamp,
           schema_version = excluded.schema_version,
           partial_revision = excluded.partial_revision,
           partial_build_timestamp = excluded.partial_build_timestamp,
           partial_selector_json = excluded.partial_selector_json,
           compiler_version = excluded.compiler_version`,
        {
          $repoId: input.repoId,
          $indexedRevision: input.indexedRevision ?? null,
          $buildTimestamp: buildTimestamp,
          $schemaVersion: schemaVersion,
          $partialRevision: input.partialRevision ?? null,
          $partialBuildTimestamp: partialBuildTimestamp ?? null,
          $partialSelectorJson: input.partialSelector === undefined ? null : encodeJson(input.partialSelector),
          $compilerVersion: input.compilerVersion ?? null
        }
      );
    });
    return {
      repoId: input.repoId,
      ...(input.indexedRevision === undefined ? {} : { indexedRevision: input.indexedRevision }),
      buildTimestamp,
      schemaVersion,
      ...(input.partialRevision === undefined ? {} : { partialRevision: input.partialRevision }),
      ...(partialBuildTimestamp === undefined ? {} : { partialBuildTimestamp }),
      ...(input.partialSelector === undefined ? {} : { partialSelector: input.partialSelector }),
      ...(input.compilerVersion === undefined ? {} : { compilerVersion: input.compilerVersion })
    };
  }

  /** Records partial-build state without advancing the full indexed revision. */
  recordPartialBuild(input: {
    repoId: string;
    revision: string;
    selector: PartialBuildSelector;
    buildTimestamp?: string | undefined;
  }): ManifestRecord {
    const current = this.get(input.repoId);
    const partialBuildTimestamp = input.buildTimestamp ?? new Date().toISOString();
    return this.upsert({
      repoId: input.repoId,
      ...(current?.indexedRevision === undefined ? {} : { indexedRevision: current.indexedRevision }),
      buildTimestamp: current?.buildTimestamp ?? partialBuildTimestamp,
      schemaVersion: current?.schemaVersion ?? STORE_SCHEMA_VERSION,
      ...(current?.compilerVersion === undefined ? {} : { compilerVersion: current.compilerVersion }),
      partialRevision: input.revision,
      partialBuildTimestamp,
      partialSelector: input.selector
    });
  }

  /** Clears partial-build state after a successful full build. */
  clearPartialBuild(repoId: string): ManifestRecord | undefined {
    const current = this.get(repoId);
    if (current === undefined) {
      return undefined;
    }
    return this.upsert({
      repoId,
      indexedRevision: current.indexedRevision,
      buildTimestamp: current.buildTimestamp,
      schemaVersion: current.schemaVersion,
      compilerVersion: current.compilerVersion
    });
  }

  /** Returns manifest state for one repository. */
  get(repoId: string): ManifestRecord | undefined {
    return this.withRepositoryErrors("getManifest", () => {
      const row = this.db.get<ManifestRow>(
        `SELECT repo_id, indexed_revision, build_timestamp, schema_version, partial_revision, partial_build_timestamp, partial_selector_json, compiler_version
         FROM manifests
         WHERE repo_id = $repoId`,
        { $repoId: repoId }
      );
      return row === undefined ? undefined : mapManifestRow(row);
    });
  }

  /** Lists all manifests in deterministic repo order. */
  list(): ManifestRecord[] {
    return this.withRepositoryErrors("listManifests", () =>
      this.db
        .all<ManifestRow>(
          `SELECT repo_id, indexed_revision, build_timestamp, schema_version, partial_revision, partial_build_timestamp, partial_selector_json, compiler_version
           FROM manifests
           ORDER BY repo_id`
        )
        .map(mapManifestRow)
    );
  }

  private withRepositoryErrors<T>(operation: string, action: () => T): T {
    try {
      return action();
    } catch (error) {
      throw new StoreRepositoryError("Manifest persistence operation failed.", {
        operation,
        entity: "manifest",
        cause: error
      });
    }
  }
}

interface ManifestRow {
  repo_id: string;
  indexed_revision: string | null;
  build_timestamp: string;
  schema_version: number;
  partial_revision: string | null;
  partial_build_timestamp: string | null;
  partial_selector_json: string | null;
  compiler_version: string | null;
}

function mapManifestRow(row: ManifestRow): ManifestRecord {
  return {
    repoId: row.repo_id,
    ...(row.indexed_revision === null ? {} : { indexedRevision: row.indexed_revision }),
    buildTimestamp: row.build_timestamp,
    schemaVersion: row.schema_version,
    ...(row.partial_revision === null ? {} : { partialRevision: row.partial_revision }),
    ...(row.partial_build_timestamp === null ? {} : { partialBuildTimestamp: row.partial_build_timestamp }),
    ...(row.partial_selector_json === null
      ? {}
      : { partialSelector: decodeJson<PartialBuildSelector>(row.partial_selector_json, "manifests.partial_selector_json") }),
    ...(row.compiler_version === null ? {} : { compilerVersion: row.compiler_version })
  };
}
