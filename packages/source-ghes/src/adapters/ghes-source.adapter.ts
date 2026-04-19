import type { FileEntry, RepoConfig, RepoRevision, RepoSourceAdapter, SourceChange, SourceFile } from "@atlas/core";

import { readBlobText } from "../api/blobs";
import { compareCommits, resolveCommit } from "../api/commits";
import { findTreeBlob, readRepositoryTree, treeToFileEntries } from "../api/trees";
import type { GhesAuthConfig } from "../client/auth";
import { GhesClient, type GhesFetch } from "../client/ghes-client";
import {
  GhesBlobReadError,
  GhesConfigurationError,
  GhesDiffError,
  GhesUnsupportedRepoModeError
} from "../errors";

export interface GhesSourceDiagnosticEvent {
  type:
    | "revision_resolved"
    | "tree_listed"
    | "file_read"
    | "diff_computed";
  repoId: string;
  details?: Record<string, string | number | boolean | undefined> | undefined;
}

export type GhesSourceDiagnosticSink = (event: GhesSourceDiagnosticEvent) => void;

export interface GhesSourceAdapterOptions {
  auth?: GhesAuthConfig | undefined;
  authByRepoId?: Record<string, GhesAuthConfig> | undefined;
  fetch?: GhesFetch | undefined;
  onDiagnostic?: GhesSourceDiagnosticSink | undefined;
}

/** Source adapter backed by GitHub Enterprise Server REST APIs. */
export class GhesSourceAdapter implements RepoSourceAdapter {
  readonly #auth: GhesAuthConfig | undefined;
  readonly #authByRepoId: Record<string, GhesAuthConfig>;
  readonly #fetch: GhesFetch | undefined;
  readonly #onDiagnostic: GhesSourceDiagnosticSink | undefined;

  constructor(options: GhesSourceAdapterOptions = {}) {
    this.#auth = options.auth;
    this.#authByRepoId = options.authByRepoId ?? {};
    this.#fetch = options.fetch;
    this.#onDiagnostic = options.onDiagnostic;
  }

  async getRevision(repo: RepoConfig): Promise<RepoRevision> {
    const github = requireGhesRepo(repo);
    const client = this.#clientFor(repo);
    const commit = await resolveCommit({
      client,
      repoId: repo.repoId,
      owner: github.owner,
      repoName: github.name,
      ref: github.ref
    });
    this.#onDiagnostic?.({
      type: "revision_resolved",
      repoId: repo.repoId,
      details: { ref: github.ref, revision: commit.sha }
    });
    return {
      repoId: repo.repoId,
      ref: github.ref,
      revision: commit.sha
    };
  }

  async listFiles(repo: RepoConfig): Promise<FileEntry[]> {
    const github = requireGhesRepo(repo);
    const client = this.#clientFor(repo);
    const commit = await resolveCommit({
      client,
      repoId: repo.repoId,
      owner: github.owner,
      repoName: github.name,
      ref: github.ref
    });
    const tree = await readRepositoryTree({
      client,
      repoId: repo.repoId,
      owner: github.owner,
      repoName: github.name,
      treeSha: commit.commit.tree.sha,
      recursive: true
    });
    const files = treeToFileEntries(tree);
    this.#onDiagnostic?.({
      type: "tree_listed",
      repoId: repo.repoId,
      details: { fileCount: files.filter((file) => file.type === "file").length, entryCount: files.length }
    });
    return files;
  }

  async readFile(repo: RepoConfig, path: string): Promise<SourceFile> {
    const github = requireGhesRepo(repo);
    const normalizedPath = normalizeRelativePath(path);
    const client = this.#clientFor(repo);
    const commit = await resolveCommit({
      client,
      repoId: repo.repoId,
      owner: github.owner,
      repoName: github.name,
      ref: github.ref
    });
    const tree = await readRepositoryTree({
      client,
      repoId: repo.repoId,
      owner: github.owner,
      repoName: github.name,
      treeSha: commit.commit.tree.sha,
      recursive: true
    });
    const blob = findTreeBlob(tree, normalizedPath);
    if (!blob) {
      throw new GhesBlobReadError({
        repoId: repo.repoId,
        owner: github.owner,
        repoName: github.name,
        path: normalizedPath,
        ref: github.ref,
        operation: "readFile",
        message: "Path does not exist in GHES tree or is not a file."
      });
    }
    const content = await readBlobText({
      client,
      repoId: repo.repoId,
      owner: github.owner,
      repoName: github.name,
      sha: blob.sha,
      path: normalizedPath
    });
    this.#onDiagnostic?.({
      type: "file_read",
      repoId: repo.repoId,
      details: { path: normalizedPath, bytes: content.length }
    });
    return {
      path: normalizedPath,
      content
    };
  }

  async diffPaths(repo: RepoConfig, from: string, to: string): Promise<SourceChange[]> {
    const github = requireGhesRepo(repo);
    const changes = await compareCommits({
      client: this.#clientFor(repo),
      repoId: repo.repoId,
      owner: github.owner,
      repoName: github.name,
      from,
      to
    });
    this.#onDiagnostic?.({
      type: "diff_computed",
      repoId: repo.repoId,
      details: { fromRevision: from, toRevision: to, changedPathCount: changes.length }
    });
    return changes;
  }

  #clientFor(repo: RepoConfig): GhesClient {
    const github = requireGhesRepo(repo);
    const auth = this.#authByRepoId[repo.repoId] ?? this.#auth;
    if (!auth) {
      throw new GhesConfigurationError({
        repoId: repo.repoId,
        owner: github.owner,
        repoName: github.name,
        operation: "clientFor",
        message: "No GHES authentication configuration was provided for repo."
      });
    }
    return new GhesClient({
      baseUrl: github.baseUrl,
      auth,
      ...(this.#fetch === undefined ? {} : { fetch: this.#fetch })
    });
  }
}

export function requireGhesRepo(repo: RepoConfig): NonNullable<RepoConfig["github"]> {
  if (repo.mode !== "ghes-api" || !repo.github) {
    throw new GhesUnsupportedRepoModeError({
      repoId: repo.repoId,
      operation: "requireGhesRepo"
    });
  }
  return repo.github;
}

function normalizeRelativePath(path: string): string {
  const normalizedPath = path.replaceAll("\\", "/").replace(/^\/+/, "");
  if (normalizedPath.length === 0 || normalizedPath === ".." || normalizedPath.startsWith("../") || normalizedPath.includes("/../")) {
    throw new GhesDiffError({
      path,
      operation: "normalizeRelativePath",
      message: "Repository-relative path must not traverse outside the repository."
    });
  }
  return normalizedPath;
}
