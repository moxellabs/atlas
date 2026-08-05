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
  SkillRepository,
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
  readonly ignoreMissing?: boolean;
}): CorpusEvidence[] {
  const store = openStore({ path: input.corpusPath, readOnly: true });
  try {
    const documents = new DocRepository(store).listByRepo(input.repoId);
    const byPath = new Map(
      documents.map((document) => [document.path, document]),
    );
    const sections = new SectionRepository(store);
    const requestedPaths = new Set(input.paths);
    const artifactEvidence = new Map<string, CorpusEvidence | undefined>();
    const skillRepository = new SkillRepository(store);
    const skills = skillRepository
      .listByRepo(input.repoId)
      .filter((skill) => requestedPaths.has(skill.sourceDocPath));
    for (const skill of skills) {
      for (const artifact of skillRepository.listArtifacts(skill.skillId)) {
        if (artifact.content === undefined) continue;
        const evidence = {
          path: artifact.path,
          text: `Skill artifact bundled by ${skill.sourceDocPath}:\n\n${artifact.content}`,
        };
        artifactEvidence.set(
          artifact.path,
          artifactEvidence.has(artifact.path) ? undefined : evidence,
        );
        artifactEvidence.set(
          `${skill.sourceDocPath.slice(0, skill.sourceDocPath.lastIndexOf("/") + 1)}${artifact.path}`,
          evidence,
        );
      }
    }
    return [...new Set(input.paths)].flatMap((path) => {
      const document = byPath.get(path);
      if (document === undefined) {
        const artifact = artifactEvidence.get(path);
        if (artifact !== undefined) {
          return [{ ...artifact, path }];
        }
        if (input.ignoreMissing === true) {
          return [];
        }
        throw new Error(
          `Judge evidence path ${path} is absent from the isolated ${input.repoId} corpus.`,
        );
      }
      return [
        {
          path,
          text: sections
            .listByDocument(document.docId)
            .flatMap((section) => [
              section.text,
              ...section.codeBlocks.map(
                (block) => `\`\`\`${block.lang ?? ""}\n${block.code}\n\`\`\``,
              ),
            ])
            .filter((part) => part.length > 0)
            .join("\n\n"),
        },
      ];
    });
  } finally {
    store.close();
  }
}
