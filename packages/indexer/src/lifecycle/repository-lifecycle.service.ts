import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ResolvedAtlasConfig } from "@atlas/config";
import {
  stableHash,
  type RepoConfig,
  type RepositoryRefreshState,
  type RepositoryRefreshStateProvider,
} from "@atlas/core";

import type {
  BuildReport,
  IndexerDiagnostic,
  IndexerService,
  SyncReport,
} from "../types/indexer.types";

const STATE_SCHEMA_VERSION = 1;
const MAX_CHANGED_PATHS = 200;
const DEFAULT_LOCK_STALE_MS = 60 * 60 * 1000;

export type RepositoryLifecycleDiagnosticType =
  | "refresh_started"
  | "refresh_completed"
  | "refresh_failed"
  | "refresh_skipped"
  | "lock_recovered"
  | "state_ignored";

/** Structured diagnostic emitted by background repository reconciliation. */
export interface RepositoryLifecycleDiagnostic {
  type: RepositoryLifecycleDiagnosticType;
  message: string;
  repoId?: string | undefined;
  details?: Record<string, string | number | boolean | undefined> | undefined;
}

/** Dependencies and test seams for repository lifecycle reconciliation. */
export interface RepositoryLifecycleServiceOptions {
  config: ResolvedAtlasConfig;
  indexer: Pick<IndexerService, "syncRepo" | "buildRepo">;
  onCorpusChanged?:
    | ((repoId: string, state: RepositoryRefreshState) => void | Promise<void>)
    | undefined;
  onDiagnostic?:
    | ((diagnostic: RepositoryLifecycleDiagnostic) => void)
    | undefined;
  now?: (() => number) | undefined;
  stateDir?: string | undefined;
  lockStaleMs?: number | undefined;
}

/**
 * Owns nonblocking source checks and transactional corpus rebuilds for imported
 * repositories. Query-time consumers only read its synchronous state snapshot.
 */
export class RepositoryLifecycleService implements RepositoryRefreshStateProvider {
  private readonly states = new Map<string, RepositoryRefreshState>();
  private readonly config: ResolvedAtlasConfig;
  private readonly indexer: Pick<IndexerService, "syncRepo" | "buildRepo">;
  private readonly onCorpusChanged?: RepositoryLifecycleServiceOptions["onCorpusChanged"];
  private readonly onDiagnostic?: RepositoryLifecycleServiceOptions["onDiagnostic"];
  private readonly now: () => number;
  private readonly stateDir: string;
  private readonly lockStaleMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private activeCycle: Promise<void> | undefined;
  private started = false;
  private closed = false;

  constructor(options: RepositoryLifecycleServiceOptions) {
    this.config = options.config;
    this.indexer = options.indexer;
    this.onCorpusChanged = options.onCorpusChanged;
    this.onDiagnostic = options.onDiagnostic;
    this.now = options.now ?? Date.now;
    this.stateDir =
      options.stateDir ??
      join(options.config.config.cacheDir, "lifecycle", "repository-refresh");
    this.lockStaleMs = options.lockStaleMs ?? DEFAULT_LOCK_STALE_MS;
  }

  /** Starts an immediate due check and an unreferenced periodic timer. */
  start(): void {
    if (
      this.started ||
      this.closed ||
      !this.config.config.lifecycle.repositoryRefresh.enabled
    ) {
      return;
    }
    this.started = true;
    void this.scheduleCycle();
    this.timer = setInterval(
      () => void this.scheduleCycle(),
      this.config.config.lifecycle.repositoryRefresh.intervalMs,
    );
    this.timer.unref();
  }

  /** Runs every currently due repository check, coalescing concurrent callers. */
  async refreshDueRepositories(): Promise<void> {
    await this.scheduleCycle();
  }

  /** Forces one eligible repository through the lifecycle path. */
  async refreshRepository(
    repoId: string,
  ): Promise<RepositoryRefreshState | undefined> {
    const repo = this.eligibleRepos().find(
      (candidate) => candidate.repoId === repoId,
    );
    if (repo === undefined || this.closed) return undefined;
    await this.refreshOne(repo, true);
    return this.getRepositoryRefreshState(repoId);
  }

  getRepositoryRefreshState(
    repoId: string,
  ): RepositoryRefreshState | undefined {
    const state = this.states.get(repoId);
    return state === undefined ? undefined : cloneState(state);
  }

  /** Stops future work and waits for the active refresh pass to settle. */
  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    this.timer = undefined;
    await this.activeCycle;
  }

  private scheduleCycle(): Promise<void> {
    if (
      this.closed ||
      !this.config.config.lifecycle.repositoryRefresh.enabled
    ) {
      return Promise.resolve();
    }
    if (this.activeCycle !== undefined) return this.activeCycle;
    const cycle = this.refreshEligibleRepos().catch((error: unknown) => {
      this.emit({
        type: "refresh_failed",
        message: `Repository refresh cycle failed: ${errorMessage(error)}`,
      });
    });
    const active = cycle.finally(() => {
      if (this.activeCycle === active) this.activeCycle = undefined;
    });
    this.activeCycle = active;
    return active;
  }

  private async refreshEligibleRepos(): Promise<void> {
    await mkdir(this.stateDir, { recursive: true });
    for (const repo of this.eligibleRepos()) {
      if (this.closed) return;
      await this.refreshOne(repo, false);
    }
  }

  private eligibleRepos(): RepoConfig[] {
    return this.config.runtimeRepos.filter(
      (repo) =>
        repo.mode === "ghes-api" ||
        (repo.mode === "local-git" && repo.git?.refMode !== "current-checkout"),
    );
  }

  private async refreshOne(repo: RepoConfig, force: boolean): Promise<void> {
    const persisted = await this.readState(repo.repoId);
    if (persisted !== undefined) this.states.set(repo.repoId, persisted);
    if (!force && !this.isDue(persisted)) {
      this.emit({
        type: "refresh_skipped",
        repoId: repo.repoId,
        message: `Repository ${repo.repoId} refresh is inside its TTL.`,
      });
      return;
    }

    const lockToken = await this.acquireLock(repo.repoId);
    if (lockToken === undefined) {
      const current = await this.readState(repo.repoId);
      if (current !== undefined) this.states.set(repo.repoId, current);
      this.emit({
        type: "refresh_skipped",
        repoId: repo.repoId,
        message: `Repository ${repo.repoId} is being refreshed by another Atlas process.`,
      });
      return;
    }

    try {
      const current = await this.readState(repo.repoId);
      if (current !== undefined) this.states.set(repo.repoId, current);
      if (!force && !this.isDue(current)) return;
      await this.performRefresh(repo, current);
    } finally {
      await this.releaseLock(repo.repoId, lockToken);
    }
  }

  private async performRefresh(
    repo: RepoConfig,
    previous: RepositoryRefreshState | undefined,
  ): Promise<void> {
    const startedAt = isoTime(this.now());
    const refreshing: RepositoryRefreshState = {
      repoId: repo.repoId,
      status: "refreshing",
      ...(previous?.lastCheckedAt === undefined
        ? {}
        : { lastCheckedAt: previous.lastCheckedAt }),
      ...(previous?.lastSuccessfulRefreshAt === undefined
        ? {}
        : { lastSuccessfulRefreshAt: previous.lastSuccessfulRefreshAt }),
      refreshStartedAt: startedAt,
      ...(previous?.sourceRevision === undefined
        ? {}
        : { sourceRevision: previous.sourceRevision }),
      ...(previous?.indexedRevision === undefined
        ? {}
        : { indexedRevision: previous.indexedRevision }),
      changedPaths: [...(previous?.changedPaths ?? [])],
    };
    await this.saveState(refreshing);
    this.emit({
      type: "refresh_started",
      repoId: repo.repoId,
      message: `Refreshing repository ${repo.repoId}.`,
    });

    let sync: SyncReport | undefined;
    try {
      sync = await this.indexer.syncRepo(repo.repoId);
      const syncFailure = reportFailure(sync.diagnostics);
      if (sync.status === "failed" || syncFailure !== undefined) {
        await this.saveFailure(repo.repoId, refreshing, syncFailure);
        return;
      }

      let build: BuildReport | undefined;
      if (sync.corpusAffected) {
        build = await this.indexer.buildRepo(repo.repoId);
        const buildFailure = reportFailure(build.diagnostics);
        if (buildFailure !== undefined) {
          await this.saveFailure(
            repo.repoId,
            {
              ...refreshing,
              ...(sync.currentRevision === undefined
                ? {}
                : { sourceRevision: sync.currentRevision }),
            },
            buildFailure,
          );
          return;
        }
      }

      const completedAt = isoTime(this.now());
      const stale = build?.recovery.stale ?? sync.recovery.stale;
      const sourceRevision = build?.currentRevision ?? sync.currentRevision;
      const state: RepositoryRefreshState = {
        repoId: repo.repoId,
        status: stale ? "stale" : "fresh",
        lastCheckedAt: completedAt,
        lastSuccessfulRefreshAt: completedAt,
        ...(sourceRevision === undefined ? {} : { sourceRevision }),
        ...(stale || sourceRevision === undefined
          ? previous?.indexedRevision === undefined
            ? {}
            : { indexedRevision: previous.indexedRevision }
          : { indexedRevision: sourceRevision }),
        changedPaths: boundedPaths(sync.changedPaths),
      };
      await this.saveState(state);
      this.emit({
        type: "refresh_completed",
        repoId: repo.repoId,
        message: `Repository ${repo.repoId} refresh completed with status ${state.status}.`,
        details: {
          sourceChanged: sync.sourceChanged,
          corpusAffected: sync.corpusAffected,
          changedPathCount: state.changedPaths.length,
        },
      });
      if (sync.status === "updated" || build?.manifestUpdated === true) {
        await this.onCorpusChanged?.(repo.repoId, cloneState(state));
      }
    } catch (error) {
      await this.saveFailure(
        repo.repoId,
        {
          ...refreshing,
          ...(sync?.currentRevision === undefined
            ? {}
            : { sourceRevision: sync.currentRevision }),
        },
        { message: errorMessage(error) },
      );
    }
  }

  private async saveFailure(
    repoId: string,
    previous: RepositoryRefreshState,
    failure: { code?: string | undefined; message: string } | undefined,
  ): Promise<void> {
    const error = failure ?? {
      message: `Repository ${repoId} refresh failed.`,
    };
    const state: RepositoryRefreshState = {
      ...previous,
      status: "refresh_failed",
      lastCheckedAt: isoTime(this.now()),
      refreshStartedAt: undefined,
      error,
    };
    await this.saveState(state);
    this.emit({
      type: "refresh_failed",
      repoId,
      message: error.message,
      ...(error.code === undefined ? {} : { details: { code: error.code } }),
    });
  }

  private isDue(state: RepositoryRefreshState | undefined): boolean {
    if (state === undefined || state.status === "refreshing") return true;
    if (state.lastCheckedAt === undefined) return true;
    const checkedAt = Date.parse(state.lastCheckedAt);
    if (!Number.isFinite(checkedAt)) return true;
    return (
      this.now() - checkedAt >=
      this.config.config.lifecycle.repositoryRefresh.intervalMs
    );
  }

  private async readState(
    repoId: string,
  ): Promise<RepositoryRefreshState | undefined> {
    try {
      const raw = JSON.parse(
        await readFile(this.statePath(repoId), "utf8"),
      ) as unknown;
      const state = parsePersistedState(raw, repoId);
      if (state === undefined) {
        this.emit({
          type: "state_ignored",
          repoId,
          message: `Ignored invalid repository refresh state for ${repoId}.`,
        });
      }
      return state;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return undefined;
      if (error instanceof SyntaxError) {
        this.emit({
          type: "state_ignored",
          repoId,
          message: `Ignored unreadable repository refresh state for ${repoId}.`,
        });
        return undefined;
      }
      throw error;
    }
  }

  private async saveState(state: RepositoryRefreshState): Promise<void> {
    await mkdir(this.stateDir, { recursive: true });
    const path = this.statePath(state.repoId);
    const temporaryPath = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await writeFile(
      temporaryPath,
      `${JSON.stringify({ schemaVersion: STATE_SCHEMA_VERSION, ...state }, null, 2)}\n`,
      { mode: 0o600 },
    );
    await rename(temporaryPath, path);
    this.states.set(state.repoId, cloneState(state));
  }

  private async acquireLock(repoId: string): Promise<string | undefined> {
    await mkdir(this.stateDir, { recursive: true });
    const path = this.lockPath(repoId);
    const token = crypto.randomUUID();
    try {
      await this.createOwnedLock(path, token);
      return token;
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
    }

    try {
      const lockStats = await stat(path);
      if (this.now() - lockStats.mtimeMs < this.lockStaleMs) return undefined;
      const retiredPath = `${path}.stale.${process.pid}.${crypto.randomUUID()}`;
      await rename(path, retiredPath);
      await rm(retiredPath, { recursive: true, force: true });
      try {
        await this.createOwnedLock(path, token);
      } catch (error) {
        if (isNodeError(error, "EEXIST")) return undefined;
        throw error;
      }
      this.emit({
        type: "lock_recovered",
        repoId,
        message: `Recovered stale repository refresh lock for ${repoId}.`,
      });
      return token;
    } catch (error) {
      if (isNodeError(error, "ENOENT") || isNodeError(error, "EEXIST")) {
        return undefined;
      }
      throw error;
    }
  }

  private async createOwnedLock(path: string, token: string): Promise<void> {
    await mkdir(path);
    try {
      await writeFile(join(path, "owner"), token, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      await rm(path, { recursive: true, force: true });
      throw error;
    }
  }

  private async releaseLock(repoId: string, token: string): Promise<void> {
    const path = this.lockPath(repoId);
    try {
      if ((await readFile(join(path, "owner"), "utf8")) !== token) return;
      await rm(path, { recursive: true, force: true });
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }
  }

  private statePath(repoId: string): string {
    return join(this.stateDir, `${stableHash(repoId)}.json`);
  }

  private lockPath(repoId: string): string {
    return join(this.stateDir, `${stableHash(repoId)}.lock`);
  }

  private emit(diagnostic: RepositoryLifecycleDiagnostic): void {
    this.onDiagnostic?.(diagnostic);
  }
}

function reportFailure(
  diagnostics: readonly IndexerDiagnostic[],
): { code?: string | undefined; message: string } | undefined {
  const failure = diagnostics.find(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (failure === undefined) return undefined;
  return {
    ...(failure.code === undefined ? {} : { code: failure.code }),
    message: failure.message,
  };
}

function parsePersistedState(
  value: unknown,
  expectedRepoId: string,
): RepositoryRefreshState | undefined {
  if (!isRecord(value) || value.schemaVersion !== STATE_SCHEMA_VERSION)
    return undefined;
  if (value.repoId !== expectedRepoId || !isRefreshStatus(value.status))
    return undefined;
  if (
    !Array.isArray(value.changedPaths) ||
    !value.changedPaths.every((path) => typeof path === "string")
  ) {
    return undefined;
  }
  const persistedError = value.error;
  if (
    persistedError !== undefined &&
    (!isRecord(persistedError) || typeof persistedError.message !== "string")
  ) {
    return undefined;
  }
  return {
    repoId: expectedRepoId,
    status: value.status,
    ...optionalString(value, "lastCheckedAt"),
    ...optionalString(value, "lastSuccessfulRefreshAt"),
    ...optionalString(value, "refreshStartedAt"),
    ...optionalString(value, "sourceRevision"),
    ...optionalString(value, "indexedRevision"),
    changedPaths: boundedPaths(value.changedPaths),
    ...(persistedError === undefined
      ? {}
      : {
          error: {
            ...optionalString(persistedError, "code"),
            message: persistedError.message as string,
          },
        }),
  };
}

function optionalString<T extends string>(
  value: Record<string, unknown>,
  key: T,
): Partial<Record<T, string | undefined>> {
  const field = value[key];
  return field === undefined || typeof field !== "string"
    ? {}
    : ({ [key]: field } as Partial<Record<T, string>>);
}

function isRefreshStatus(
  value: unknown,
): value is RepositoryRefreshState["status"] {
  return ["fresh", "stale", "refreshing", "refresh_failed"].includes(
    String(value),
  );
}

function boundedPaths(paths: readonly string[]): string[] {
  return [...new Set(paths)]
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_CHANGED_PATHS);
}

function cloneState(state: RepositoryRefreshState): RepositoryRefreshState {
  return {
    ...state,
    changedPaths: [...state.changedPaths],
    ...(state.error === undefined ? {} : { error: { ...state.error } }),
  };
}

function isoTime(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
