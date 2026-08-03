import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  buildArtifactManifest,
  buildDocsIndex,
  exportCorpusDbSnapshot,
  writeArtifactChecksums,
  writePrettyJson,
} from "@atlas/indexer";
import { ManifestRepository, openStore, RepoRepository } from "@atlas/store";

export function missingArtifactConfig(baseUrl: string): string {
  return `
version: 1
cacheDir: .cache/atlas
logLevel: info
server:
  transport: http
hosts:
  - name: github.mycorp.com
    webUrl: https://github.mycorp.com
    apiUrl: ${baseUrl}
    protocol: https
    default: true
    priority: 100
repos: []
`;
}

export async function createConsumerUxWorkspace(
  root: string,
): Promise<{ repoPath: string }> {
  const repoPath = join(root, "consumer-ux-repo");
  await mkdir(join(repoPath, "docs"), { recursive: true });
  await writeFile(
    join(repoPath, "docs", "runbook.md"),
    "# Deployment rollback\n\nRollback deployment using local imported corpus docs.\n",
  );
  return { repoPath };
}

export async function writeConsumerUxArtifact(
  repoPath: string,
  revision: string,
): Promise<void> {
  await createCliArtifactFixture(repoPath, revision);
}

export function artifactFixtureFetch(
  root: string,
  artifactRoot: string,
): typeof fetch {
  return (async (input) => {
    const url = new URL(String(input));
    const prefix = `/api/v3/repos/moxellabs/atlas/contents/${artifactRoot}/`;
    if (!url.pathname.startsWith(prefix))
      return new Response(JSON.stringify({ message: "not found" }), {
        status: 404,
      });
    const file = url.pathname.slice(prefix.length);
    const artifactFile = Bun.file(join(root, artifactRoot, file));
    if (!(await artifactFile.exists()))
      return new Response(JSON.stringify({ message: "not found" }), {
        status: 404,
      });
    return new Response(await artifactFile.arrayBuffer());
  }) as typeof fetch;
}

export async function createCliArtifactFixture(
  root: string,
  revision: string,
  artifactRoot = join(".moxel", "atlas"),
): Promise<void> {
  const repoId = "github.com/moxellabs/atlas";
  const sourceDbPath = join(root, "atlas-source.db");
  const db = openStore({ path: sourceDbPath, migrate: true });
  try {
    new RepoRepository(db).upsert({ repoId, mode: "local-git", revision });
    new ManifestRepository(db).upsert({
      repoId,
      indexedRevision: revision,
      compilerVersion: "test",
    });
    const artifactDir = join(root, artifactRoot);
    await mkdir(artifactDir, { recursive: true });
    await writePrettyJson(
      join(artifactDir, "manifest.json"),
      buildArtifactManifest({ repoId, ref: "main", indexedRevision: revision }),
    );
    await writePrettyJson(
      join(artifactDir, "docs.index.json"),
      buildDocsIndex(db, repoId),
    );
    db.close();
    await exportCorpusDbSnapshot(sourceDbPath, join(artifactDir, "corpus.db"));
    await writeArtifactChecksums(artifactDir);
  } finally {
    try {
      db.close();
    } catch {
      // Closed after artifact docs index write.
    }
  }
}
