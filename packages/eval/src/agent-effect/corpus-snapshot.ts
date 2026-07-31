import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { deleteRepoCorpus, openStore, RepoRepository } from "@atlas/store";

export interface IsolatedCorpusProvenance {
  readonly indexedRevision: string;
  readonly corpusDigest: string;
}

/** Copies one complete repository corpus into an evaluator-owned SQLite file. */
export async function isolateCorpusSnapshot(input: {
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly repoId: string;
}): Promise<IsolatedCorpusProvenance> {
  if (!(await Bun.file(input.sourcePath).exists())) {
    throw new Error(
      `Global Atlas corpus is unavailable at ${input.sourcePath}. Index ${input.repoId} before running the discovery smoke.`,
    );
  }

  const source = new Database(input.sourcePath, { readonly: true });
  let indexedRevision: string;
  let serialized: Uint8Array;
  try {
    const indexed = source
      .query<{ indexedRevision: string | null }, [string]>(
        `SELECT manifests.indexed_revision AS indexedRevision
         FROM repos INNER JOIN manifests USING (repo_id)
         WHERE repos.repo_id = ?
         LIMIT 1`,
      )
      .get(input.repoId);
    if (indexed?.indexedRevision == null) {
      throw new Error(
        `Global Atlas corpus does not contain a complete index for ${input.repoId}. Index it before running the discovery smoke.`,
      );
    }
    indexedRevision = indexed.indexedRevision;
    serialized = source.serialize();
  } finally {
    source.close();
  }

  await mkdir(dirname(input.targetPath), { recursive: true });
  await writeFile(input.targetPath, serialized);
  const snapshot = openStore({ path: input.targetPath });
  try {
    for (const repo of new RepoRepository(snapshot).list()) {
      if (repo.repoId !== input.repoId) deleteRepoCorpus(snapshot, repo.repoId);
    }
    snapshot.exec("VACUUM");
  } finally {
    snapshot.close();
  }

  const corpusDigest = createHash("sha256")
    .update(await readFile(input.targetPath))
    .digest("hex");
  return { indexedRevision, corpusDigest };
}
