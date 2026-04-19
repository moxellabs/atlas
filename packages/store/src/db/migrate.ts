import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { StoreMigrationError } from "../errors";
import type { StoreDatabase } from "../types";

/** Current schema version for the unreleased baseline schema. */
export const STORE_SCHEMA_VERSION = 1;

/** Description of an ordered store schema migration. */
export interface StoreMigration {
	version: number;
	name: string;
	sql: string;
}

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");

/** Ordered migrations for the local SQLite store. */
export const STORE_MIGRATIONS: readonly StoreMigration[] = [
	{
		version: STORE_SCHEMA_VERSION,
		name: "baseline_store_schema",
		sql: readFileSync(schemaPath, "utf8"),
	},
];

/** Applies all pending store migrations idempotently. */
export function migrateStore(db: StoreDatabase): void {
	try {
		ensureMigrationTable(db);
		applyCurrentBaselineSchema(db);
		for (const migration of STORE_MIGRATIONS) {
			if (!hasMigration(db, migration.version)) {
				db.transaction(() => {
					for (const statement of splitSqlStatements(migration.sql)) {
						db.run(statement);
					}
					db.run(
						"INSERT INTO schema_migrations (version, name, applied_at) VALUES ($version, $name, $appliedAt)",
						{
							$version: migration.version,
							$name: migration.name,
							$appliedAt: new Date().toISOString(),
						},
					);
				});
			}
		}
	} catch (error) {
		throw new StoreMigrationError("Failed to migrate SQLite store.", {
			operation: "migrate",
			entity: "schema",
			cause: error,
		});
	}
}

function applyCurrentBaselineSchema(db: StoreDatabase): void {
	db.transaction(() => {
		for (const statement of splitSqlStatements(
			readFileSync(schemaPath, "utf8"),
		)) {
			db.run(statement);
		}
		addColumnIfMissing(db, "documents", "description", "TEXT");
		addColumnIfMissing(
			db,
			"documents",
			"audience_json",
			"TEXT NOT NULL DEFAULT '[\"consumer\"]'",
		);
		addColumnIfMissing(
			db,
			"documents",
			"purpose_json",
			"TEXT NOT NULL DEFAULT '[\"guide\"]'",
		);
		addColumnIfMissing(
			db,
			"documents",
			"visibility",
			"TEXT NOT NULL DEFAULT 'public'",
		);
		addColumnIfMissing(db, "documents", "order_value", "INTEGER");
		addColumnIfMissing(db, "documents", "profile", "TEXT");
	});
}

function addColumnIfMissing(
	db: StoreDatabase,
	table: string,
	column: string,
	definition: string,
): void {
	const rows = db.all<{ name: string }>(`PRAGMA table_info(${table})`);
	if (!rows.some((row) => row.name === column)) {
		db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
	}
}

/** Returns the latest applied schema version, or zero before initialization. */
export function getCurrentSchemaVersion(db: StoreDatabase): number {
	const row = db.get<{ version: number }>(
		"SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
	);
	return row?.version ?? 0;
}

function ensureMigrationTable(db: StoreDatabase): void {
	db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

function hasMigration(db: StoreDatabase, version: number): boolean {
	const row = db.get<{ version: number }>(
		"SELECT version FROM schema_migrations WHERE version = $version",
		{
			$version: version,
		},
	);
	return row !== undefined;
}

function splitSqlStatements(sql: string): string[] {
	return sql
		.replace(/^--.*$/gm, "")
		.split(";")
		.map((statement) => statement.trim())
		.filter((statement) => statement.length > 0);
}
