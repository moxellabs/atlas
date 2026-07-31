import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  deleteRepoCorpus,
  DocRepository,
  openStore,
  RepoRepository,
  SectionRepository,
} from "@atlas/store";

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

export interface CorpusEvidence {
  readonly path: string;
  readonly text: string;
}

/** Reads exact source-relative documents for the judge without exposing them to answer arms. */
export function readCorpusEvidence(input: {
  readonly corpusPath: string;
  readonly repoId: string;
  readonly paths: readonly string[];
}): CorpusEvidence[] {
  const store = openStore({ path: input.corpusPath, readOnly: true });
  try {
    const documents = new DocRepository(store).listByRepo(input.repoId);
    const byPath = new Map(
      documents.map((document) => [document.path, document]),
    );
    const sections = new SectionRepository(store);
    return [...new Set(input.paths)].map((path) => {
      const document = byPath.get(path);
      if (document === undefined) {
        throw new Error(
          `Judge evidence path ${path} is absent from the isolated ${input.repoId} corpus.`,
        );
      }
      return {
        path,
        text: sections
          .listByDocument(document.docId)
          .map((section) => section.text)
          .join("\n\n"),
      };
    });
  } finally {
    store.close();
  }
}
