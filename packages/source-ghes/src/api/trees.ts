import type { FileEntry } from "@atlas/core";

import type { GhesClient } from "../client/ghes-client";
import { GhesTreeReadError } from "../errors";

export interface GhesTreeItem {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number | undefined;
  url: string;
}

export interface GhesTreeResponse {
  sha: string;
  truncated: boolean;
  tree: GhesTreeItem[];
}

export interface ReadTreeOptions {
  client: GhesClient;
  repoId: string;
  owner: string;
  repoName: string;
  treeSha: string;
  recursive?: boolean | undefined;
}

export async function readRepositoryTree(options: ReadTreeOptions): Promise<GhesTreeResponse> {
  try {
    const response = await options.client.request<GhesTreeResponse>({
      path: `/repos/${encodeSegment(options.owner)}/${encodeSegment(options.repoName)}/git/trees/${encodeSegment(options.treeSha)}`,
      query: options.recursive === true ? { recursive: "1" } : undefined,
      operation: "readRepositoryTree",
      repoId: options.repoId
    });
    validateTreeResponse(response.data);
    return response.data;
  } catch (cause) {
    if (cause instanceof GhesTreeReadError) {
      throw cause;
    }
    throw new GhesTreeReadError({
      repoId: options.repoId,
      owner: options.owner,
      repoName: options.repoName,
      ref: options.treeSha,
      operation: "readRepositoryTree",
      cause
    });
  }
}

export function treeToFileEntries(tree: GhesTreeResponse): FileEntry[] {
  if (tree.truncated) {
    throw new GhesTreeReadError({
      operation: "treeToFileEntries",
      message: "GHES tree response was truncated; refusing to return a partial file list."
    });
  }

  return tree.tree
    .filter((item) => item.type === "blob" || item.type === "tree")
    .map((item): FileEntry => ({
      path: normalizeTreePath(item.path),
      type: item.type === "blob" ? "file" : "dir"
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function findTreeBlob(tree: GhesTreeResponse, path: string): GhesTreeItem | undefined {
  const normalizedPath = normalizeTreePath(path);
  return tree.tree.find((item) => item.type === "blob" && normalizeTreePath(item.path) === normalizedPath);
}

function validateTreeResponse(value: GhesTreeResponse): void {
  if (!value || !Array.isArray(value.tree) || typeof value.sha !== "string" || typeof value.truncated !== "boolean") {
    throw new GhesTreeReadError({
      operation: "validateTreeResponse",
      message: "Unexpected GHES tree response shape."
    });
  }
}

function normalizeTreePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "");
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}
