import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  MOXEL_ATLAS_REMOTE_ARTIFACT_FILES,
  MOXEL_ATLAS_REPO_ARTIFACT_PATH,
  type FetchLike,
  type RemoteArtifactFetchInput,
  type RemoteArtifactFetchResult,
  type RemoteArtifactHeadResult,
} from "./contracts";
import { parseArtifactRepoId } from "./manifest";

export function artifactStorageDir(
  homeDir: string,
  repoId: string,
  artifactRoot = MOXEL_ATLAS_REPO_ARTIFACT_PATH,
): string {
  const [host, owner, name] = parseArtifactRepoId(repoId);
  return join(homeDir, "repos", host, owner, name, artifactRoot);
}

function rawContentsUrl(
  apiUrl: string,
  owner: string,
  name: string,
  file: string,
  ref: string,
  artifactRoot = MOXEL_ATLAS_REPO_ARTIFACT_PATH,
): string {
  return `${apiUrl.replace(/\/+$/, "")}/repos/${owner}/${name}/contents/${artifactRoot}/${file}?ref=${encodeURIComponent(ref)}`;
}

function githubHeaders(token?: string): HeadersInit {
  return token
    ? { Accept: "application/vnd.github.raw", Authorization: `Bearer ${token}` }
    : { Accept: "application/vnd.github.raw" };
}

export async function fetchRemoteArtifact(
  input: RemoteArtifactFetchInput,
  deps: { fetchImpl?: FetchLike } = {},
): Promise<RemoteArtifactFetchResult> {
  const [host] = parseArtifactRepoId(input.repoId);
  await mkdir(input.artifactDir, { recursive: true });
  for (const file of MOXEL_ATLAS_REMOTE_ARTIFACT_FILES)
    await rm(join(input.artifactDir, file), { force: true });
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const files: string[] = [];
  for (const file of MOXEL_ATLAS_REMOTE_ARTIFACT_FILES) {
    let response: Response;
    try {
      response = await fetchImpl(
        rawContentsUrl(
          input.apiUrl,
          input.owner,
          input.name,
          file,
          input.ref,
          input.artifactRoot,
        ),
        { method: "GET", headers: githubHeaders(input.token) },
      );
    } catch {
      return remoteFileFailure(
        "CLI_ARTIFACT_NOT_FOUND",
        `${file} not found in remote artifact.`,
        input,
        host,
        file,
        files,
      );
    }
    if (response.status === 404)
      return remoteFileFailure(
        "CLI_ARTIFACT_NOT_FOUND",
        `${file} not found in remote artifact.`,
        input,
        host,
        file,
        files,
      );
    if (!response.ok)
      return remoteFileFailure(
        "CLI_ARTIFACT_FETCH_FAILED",
        `Failed to fetch ${file}: HTTP ${response.status}.`,
        input,
        host,
        file,
        files,
      );
    await writeFile(
      join(input.artifactDir, file),
      Buffer.from(await response.arrayBuffer()),
    );
    files.push(file);
  }
  return {
    ok: true,
    repoId: input.repoId,
    host,
    owner: input.owner,
    name: input.name,
    ref: input.ref,
    artifactDir: input.artifactDir,
    files,
    diagnostics: [],
  };
}

function remoteFileFailure(
  code: "CLI_ARTIFACT_NOT_FOUND" | "CLI_ARTIFACT_FETCH_FAILED",
  message: string,
  input: RemoteArtifactFetchInput,
  host: string,
  path: string,
  files: string[],
): RemoteArtifactFetchResult {
  return {
    ok: false,
    code,
    repoId: input.repoId,
    host,
    owner: input.owner,
    name: input.name,
    ref: input.ref,
    artifactDir: input.artifactDir,
    files,
    diagnostics: [{ code, path, message }],
  };
}

export async function fetchRemoteHeadRevision(
  input: {
    apiUrl: string;
    owner: string;
    name: string;
    ref: string;
    token?: string | undefined;
  },
  deps: { fetchImpl?: FetchLike } = {},
): Promise<RemoteArtifactHeadResult> {
  if (/^[0-9a-f]{40}$/i.test(input.ref))
    return {
      ok: true,
      ref: input.ref,
      remoteHeadRevision: input.ref,
      diagnostics: [],
    };
  const branch = input.ref.replace(/^refs\/heads\//, "");
  const url = `${input.apiUrl.replace(/\/+$/, "")}/repos/${input.owner}/${input.name}/branches/${encodeURIComponent(branch)}`;
  const response = await (deps.fetchImpl ?? globalThis.fetch.bind(globalThis))(
    url,
    { method: "GET", headers: githubHeaders(input.token) },
  );
  if (response.status === 404)
    return {
      ok: false,
      code: "CLI_REMOTE_REF_NOT_FOUND",
      ref: input.ref,
      diagnostics: [
        {
          code: "CLI_REMOTE_REF_NOT_FOUND",
          message: `Remote ref ${input.ref} not found.`,
        },
      ],
    };
  if (!response.ok)
    return {
      ok: false,
      code: "CLI_REMOTE_REF_LOOKUP_FAILED",
      ref: input.ref,
      diagnostics: [
        {
          code: "CLI_REMOTE_REF_LOOKUP_FAILED",
          message: `Failed to resolve remote ref: HTTP ${response.status}.`,
        },
      ],
    };
  const body = await response.json();
  return {
    ok: true,
    ref: input.ref,
    remoteHeadRevision: body.commit?.sha,
    diagnostics: [],
  };
}
