import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

import { StoreInitializationError, StoreTransactionError } from "../errors";
import type { SQLParams, StoreDatabase, StoreDiagnostics } from "../types";
import { migrateStore } from "./migrate";
import { applyStorePragmas } from "./pragmas";

/** Options for opening an ATLAS SQLite store. */
export interface OpenStoreOptions {
	/** Filesystem path for the SQLite database. Use ":memory:" for ephemeral tests. */
	path: string;
	/** Run migrations during open. Defaults to false to keep bootstrap explicit. */
	migrate?: boolean | undefined;
}

type SqliteRuntime = "bun" | "node";
type SqliteDatabase = {
	exec(sql: string): unknown;
	query?(sql: string): SqliteStatement;
	prepare?(sql: string): SqliteStatement;
	transaction?<T>(operation: () => T): () => T;
	close(): void;
};
type SqliteStatement = {
	run(params?: Record<string, unknown>): unknown;
	get(params?: Record<string, unknown>): unknown;
	all(params?: Record<string, unknown>): unknown[];
};

/** Runtime SQLite-backed implementation of the ATLAS store database wrapper. */
export class AtlasStoreClient implements StoreDatabase {
	readonly path: string;
	private readonly db: SqliteDatabase;
	private readonly runtime: SqliteRuntime;
	private transactionDepth = 0;

	constructor(path: string) {
		this.path = path;
		try {
			ensureDatabaseParent(path);
			const opened = openRuntimeDatabase(path);
			this.db = opened.db;
			this.runtime = opened.runtime;
			applyStorePragmas(this);
		} catch (error) {
			throw new StoreInitializationError("Failed to open SQLite store.", {
				operation: "open",
				entity: "database",
				cause: error,
			});
		}
	}

	exec(sql: string): unknown {
		return this.db.exec(sql);
	}

	run(sql: string, params?: SQLParams): unknown {
		const statement = this.statement(sql);
		return params === undefined
			? statement.run()
			: statement.run(normalizeParams(params));
	}

	get<T = unknown>(sql: string, params?: SQLParams): T | undefined {
		const statement = this.statement(sql);
		const row =
			params === undefined
				? statement.get()
				: statement.get(normalizeParams(params));
		return row === null ? undefined : (row as T | undefined);
	}

	all<T = unknown>(sql: string, params?: SQLParams): T[] {
		const statement = this.statement(sql);
		return (
			params === undefined
				? statement.all()
				: statement.all(normalizeParams(params))
		) as T[];
	}

	transaction<T>(operation: () => T): T {
		if (this.transactionDepth > 0) {
			return operation();
		}
		try {
			this.transactionDepth++;
			if (this.runtime === "bun" && this.db.transaction !== undefined) {
				return this.db.transaction(operation)();
			}
			this.db.exec("BEGIN");
			try {
				const result = operation();
				this.db.exec("COMMIT");
				return result;
			} catch (error) {
				this.db.exec("ROLLBACK");
				throw error;
			}
		} catch (error) {
			throw new StoreTransactionError("SQLite transaction failed.", {
				operation: "transaction",
				entity: "database",
				cause: error,
			});
		} finally {
			this.transactionDepth--;
		}
	}

	close(): void {
		this.db.close();
	}

	private statement(sql: string): SqliteStatement {
		const statement =
			this.runtime === "bun" ? this.db.query?.(sql) : this.db.prepare?.(sql);
		if (statement === undefined)
			throw new Error("SQLite statement API unavailable.");
		return statement;
	}
}

function openRuntimeDatabase(path: string): {
	runtime: SqliteRuntime;
	db: SqliteDatabase;
} {
	const require = createRequire(import.meta.url);
	if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") {
		const { Database } = require("bun:sqlite") as {
			Database: new (
				path: string,
				options: { create: boolean; strict: boolean },
			) => SqliteDatabase;
		};
		return {
			runtime: "bun",
			db: new Database(path, { create: true, strict: true }),
		};
	}
	const BetterSqlite = require("better-sqlite3") as {
		default?: new (path: string) => SqliteDatabase;
	} & (new (
		path: string,
	) => SqliteDatabase);
	const Database = BetterSqlite.default ?? BetterSqlite;
	return { runtime: "node", db: new Database(path) };
}

function ensureDatabaseParent(path: string): void {
	if (path === ":memory:") return;
	mkdirSync(dirname(path), { recursive: true });
}

function normalizeParams(params: SQLParams): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(params).map(([key, value]) => [
			key.startsWith("$") ? key.slice(1) : key,
			typeof value === "boolean" ? Number(value) : value,
		]),
	);
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
	const repoCount =
		db.get<{ count: number }>("SELECT COUNT(*) AS count FROM repos")?.count ??
		0;
	const documentCount =
		db.get<{ count: number }>("SELECT COUNT(*) AS count FROM documents")
			?.count ?? 0;
	const chunkCount =
		db.get<{ count: number }>("SELECT COUNT(*) AS count FROM chunks")?.count ??
		0;
	const summaryCount =
		db.get<{ count: number }>("SELECT COUNT(*) AS count FROM summaries")
			?.count ?? 0;
	const lastMigration = db.get<{ version: number }>(
		"SELECT MAX(version) AS version FROM schema_migrations",
	)?.version;
	const ftsEntryCount =
		db.get<{ count: number }>("SELECT COUNT(*) AS count FROM fts_entries")
			?.count ?? 0;
	return {
		dbPath: db.path,
		schemaVersion: lastMigration ?? 0,
		repoCount,
		documentCount,
		chunkCount,
		summaryCount,
		...(lastMigration === undefined ? {} : { lastMigration }),
		ftsEntryCount,
	};
}
