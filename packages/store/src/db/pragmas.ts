import { StoreInitializationError } from "../errors";
import type { StoreDatabase } from "../types";

/** SQLite pragmas required for deterministic local ATLAS store behavior. */
export const STORE_PRAGMAS = [
  { sql: "PRAGMA foreign_keys = ON", reason: "Enforce declared entity relationships and cascades." },
  { sql: "PRAGMA journal_mode = WAL", reason: "Allow concurrent local readers while preserving durable writes." },
  { sql: "PRAGMA synchronous = NORMAL", reason: "Balance local durability with WAL performance for developer machines." },
  { sql: "PRAGMA busy_timeout = 5000", reason: "Wait briefly for local writer contention instead of failing immediately." },
  { sql: "PRAGMA temp_store = MEMORY", reason: "Keep transient query state fast and local to the process." }
] as const;

/** Applies documented SQLite runtime pragmas to an open database connection. */
export function applyStorePragmas(db: StoreDatabase): void {
  try {
    for (const pragma of STORE_PRAGMAS) {
      db.run(pragma.sql);
    }
  } catch (error) {
    throw new StoreInitializationError("Failed to apply SQLite pragmas.", {
      operation: "applyPragmas",
      entity: "database",
      cause: error
    });
  }
}
