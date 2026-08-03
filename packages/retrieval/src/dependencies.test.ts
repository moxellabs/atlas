import { describe, expect, test } from "bun:test";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

describe("retrieval dependency boundaries", () => {
  test("does not import source adapters or indexer from retrieval code", async () => {
    const forbiddenImports = [
      "@atlas/source-git",
      "@atlas/source-ghes",
      "@atlas/indexer",
    ];
    const files = await listTypeScriptFiles("packages/retrieval/src");

    for (const file of files.filter(
      (path) => !path.endsWith("dependencies.test.ts"),
    )) {
      const content = await readFile(file, "utf8");
      for (const forbiddenImport of forbiddenImports) {
        expect(
          content,
          `${file} must not import ${forbiddenImport}`,
        ).not.toContain(forbiddenImport);
      }
    }
  });
});

async function listTypeScriptFiles(root: string): Promise<string[]> {
  const entries = await readdir(root);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry);
    const info = await stat(path);
    if (info.isDirectory()) {
      files.push(...(await listTypeScriptFiles(path)));
    } else if (path.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}
