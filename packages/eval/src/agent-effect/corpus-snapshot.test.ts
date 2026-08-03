import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocId, createSectionId } from "@atlas/core";
import {
  DocRepository,
  countRepoCorpusRows,
  ManifestRepository,
  openStore,
  RepoRepository,
} from "@atlas/store";
import { isolateCorpusSnapshot, readCorpusEvidence } from "./corpus-snapshot";

describe("corpus snapshots", () => {
  test("isolates one complete repository into a valid corpus snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "atlas-corpus-snapshot-"));
    const sourcePath = join(directory, "source.db");
    const targetPath = join(directory, "isolated", "corpus.db");
    const targetRepoId = "github.com/justmrmendez/diffract";
    const excludedRepoId = "github.com/example/other";
    const source = openStore({ path: sourcePath, migrate: true });
    for (const [repoId, revision] of [
      [targetRepoId, "diffract-revision"],
      [excludedRepoId, "other-revision"],
    ] as const) {
      new RepoRepository(source).upsert({
        repoId,
        mode: "local-git",
        revision,
      });
      new ManifestRepository(source).upsert({
        repoId,
        indexedRevision: revision,
        compilerVersion: "compiler-v1",
      });
    }
    const evidencePath = "docs/architecture/recovery.md";
    const docId = createDocId({ repoId: targetRepoId, path: evidencePath });
    const headingPath = ["Recovery"];
    new DocRepository(source).replaceCanonicalDocument({
      docId,
      repoId: targetRepoId,
      path: evidencePath,
      sourceVersion: "diffract-revision",
      title: "Recovery",
      kind: "repo-doc",
      authority: "canonical",
      scopes: [{ level: "repo", repoId: targetRepoId }],
      sections: [
        {
          sectionId: createSectionId({ docId, headingPath, ordinal: 0 }),
          headingPath,
          ordinal: 0,
          text: "Recovery repairs only the interrupted append.",
          codeBlocks: [
            {
              lang: "text",
              code: "scene-session-manifest.json\nscene-frames.jsonl\nscene-index.bin",
            },
          ],
        },
      ],
      metadata: { tags: ["recovery", "append"] },
    });
    source.close();
    const provenance = await isolateCorpusSnapshot({
      sourcePath,
      targetPath,
      repoId: targetRepoId,
    });
    const snapshot = openStore({ path: targetPath, readOnly: true });
    try {
      expect(
        new RepoRepository(snapshot).list().map((repo) => repo.repoId),
      ).toEqual([targetRepoId]);
      expect(countRepoCorpusRows(snapshot, excludedRepoId)).toEqual({
        repos: 0,
        packages: 0,
        modules: 0,
        documents: 0,
        sections: 0,
        chunks: 0,
        summaries: 0,
        skills: 0,
        manifests: 0,
        ftsRows: 0,
      });
      expect(
        snapshot.get<{ integrity_check: string }>("PRAGMA integrity_check"),
      ).toEqual({ integrity_check: "ok" });
    } finally {
      snapshot.close();
    }
    expect(provenance).toEqual({
      indexedRevision: "diffract-revision",
      corpusDigest: createHash("sha256")
        .update(await readFile(targetPath))
        .digest("hex"),
    });
    expect(
      readCorpusEvidence({
        corpusPath: targetPath,
        repoId: targetRepoId,
        paths: [evidencePath, evidencePath],
      }),
    ).toEqual([
      {
        path: evidencePath,
        text: "Recovery repairs only the interrupted append.\n\n```text\nscene-session-manifest.json\nscene-frames.jsonl\nscene-index.bin\n```",
      },
    ]);
    expect(() =>
      readCorpusEvidence({
        corpusPath: targetPath,
        repoId: targetRepoId,
        paths: ["docs/architecture/missing.md"],
      }),
    ).toThrow("is absent from the isolated");
    const unchangedSource = openStore({ path: sourcePath, readOnly: true });
    try {
      expect(
        new RepoRepository(unchangedSource)
          .list()
          .map((repo) => repo.repoId)
          .sort(),
      ).toEqual([excludedRepoId, targetRepoId].sort());
    } finally {
      unchangedSource.close();
    }
  });

  test("rejects unavailable and incomplete source corpora", async () => {
    const directory = await mkdtemp(join(tmpdir(), "atlas-corpus-errors-"));
    await expect(
      isolateCorpusSnapshot({
        sourcePath: join(directory, "missing.db"),
        targetPath: join(directory, "target.db"),
        repoId: "github.com/example/missing",
      }),
    ).rejects.toThrow("corpus is unavailable");
    const sourcePath = join(directory, "incomplete.db");
    const source = openStore({ path: sourcePath, migrate: true });
    new RepoRepository(source).upsert({
      repoId: "github.com/example/incomplete",
      mode: "local-git",
      revision: "revision",
    });
    source.close();
    await expect(
      isolateCorpusSnapshot({
        sourcePath,
        targetPath: join(directory, "isolated.db"),
        repoId: "github.com/example/incomplete",
      }),
    ).rejects.toThrow("does not contain a complete index");
  });
});
