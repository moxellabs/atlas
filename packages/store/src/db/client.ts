import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { StoreInitializationError, StoreTransactionError } from "../errors";
import type { SQLParams, StoreDatabase } from "../types";
import { migrateStore } from "./migrate";
import { applyStorePragmas } from "./pragmas";
import type { StoreDiagnostics } from "../types";

/** Options for opening an ATLAS SQLite store. */
export interface OpenStoreOptions {
  /** Filesystem path for the SQLite database. Use ":memory:" for ephemeral tests. */
  path: string;
  /** Run migrations during open. Defaults to false to keep bootstrap explicit. */
  migrate?: boolean | undefined;
}

/** Bun SQLite-backed implementation of the ATLAS store database wrapper. */
export class AtlasStoreClient implements StoreDatabase {
  readonly path: string;
  private readonly db: Database;

  constructor(path: string) {
    this.path = path;
    try {
      ensureDatabaseParent(path);
      this.db = new Database(path, { create: true, strict: true });
      applyStorePragmas(this);
    } catch (error) {
      throw new StoreInitializationError("Failed to open SQLite store.", {
        operation: "open",
        entity: "database",
        cause: error
      });
    }
  }

  exec(sql: string): unknown {
    return this.db.exec(sql);
  }

  run(sql: string, params?: SQLParams): unknown {
    if (params === undefined) {
      return this.db.run(sql);
    }
    return this.db.query(sql).run(normalizeParams(params));
  }

  get<T = unknown>(sql: string, params?: SQLParams): T | undefined {
    const statement = this.db.query(sql);
    const row = params === undefined ? statement.get() : statement.get(normalizeParams(params));
    return row === null ? undefined : (row as T | undefined);
  }

  all<T = unknown>(sql: string, params?: SQLParams): T[] {
    const statement = this.db.query(sql);
    return (params === undefined ? statement.all() : statement.all(normalizeParams(params))) as T[];
  }

  transaction<T>(operation: () => T): T {
    try {
      return this.db.transaction(operation)();
    } catch (error) {
      throw new StoreTransactionError("SQLite transaction failed.", {
        operation: "transaction",
        entity: "database",
        cause: error
      });
    }
  }

  close(): void {
    this.db.close();
  }
}

function ensureDatabaseParent(path: string): void {
  if (path === ":memory:") {
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
}

function normalizeParams(params: SQLParams): SQLParams {
  return Object.fromEntries(Object.entries(params).map(([key, value]) => [key.startsWith("$") ? key.slice(1) : key, value]));
}

/** Opens a SQLite store and optionally applies migrations. */
export function openStore(options: OpenStoreOptions): AtlasStoreClient {
  const client = new AtlasStoreClient(options.path);
  if (options.migrate === true) {
    migrateStore(client);
  }
  return client;
}

/** Returns inspect-friendly store diagnostics from an initialized database. */
export function getStoreDiagnostics(db: AtlasStoreClient): StoreDiagnostics {
  const repoCount = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM repos")?.count ?? 0;
  const documentCount = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM documents")?.count ?? 0;
  const chunkCount = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM chunks")?.count ?? 0;
  const summaryCount = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM summaries")?.count ?? 0;
  const lastMigration = db.get<{ version: number }>("SELECT MAX(version) AS version FROM schema_migrations")?.version;
  const ftsEntryCount = db.get<{ count: number }>("SELECT COUNT(*) AS count FROM fts_entries")?.count ?? 0;
  return {
    dbPath: db.path,
    schemaVersion: lastMigration ?? 0,
    repoCount,
    documentCount,
    chunkCount,
    summaryCount,
    ...(lastMigration === undefined ? {} : { lastMigration }),
    ftsEntryCount
  };
}
