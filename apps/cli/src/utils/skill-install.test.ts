import { describe, expect, test } from "bun:test";
import type { SkillArtifactRecord, SkillRecord } from "@atlas/store";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  installSkills,
  SkillInstallError,
  type SkillInstallTarget,
} from "./skill-install";

describe("skill installer", () => {
  test("renders target-specific workspace files", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-skill-install-"));
    try {
      for (const target of [
        "codex",
        "claude-code",
        "cursor",
        "vscode-copilot",
      ] as SkillInstallTarget[]) {
        const result = await installSkills({
          target,
          scope: "workspace",
          cwd: root,
          workspacePath: root,
          homeDir: join(root, "home"),
          dryRun: false,
          overwrite: false,
          fileExists: async () => false,
          skills: [{ record: skillRecord, artifacts: [artifactRecord] }],
        });
        expect(result.writtenFiles).toHaveLength(
          target === "codex" || target === "claude-code" ? 2 : 1,
        );
      }

      expect(
        await readFile(
          join(root, ".codex", "skills", "auth-skill", "SKILL.md"),
          "utf8",
        ),
      ).toContain("ATLAS skill ID: skill_auth");
      expect(
        await readFile(
          join(root, ".claude", "skills", "auth-skill", "SKILL.md"),
          "utf8",
        ),
      ).toContain('name: "auth-skill"');
      expect(
        await readFile(
          join(root, ".cursor", "rules", "auth-skill.mdc"),
          "utf8",
        ),
      ).toContain("alwaysApply: false");
      expect(
        await readFile(
          join(root, ".github", "instructions", "auth-skill.instructions.md"),
          "utf8",
        ),
      ).toContain('applyTo: "**"');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects unsafe bundled artifact paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-skill-install-"));
    try {
      await expect(
        installSkills({
          target: "codex",
          scope: "workspace",
          cwd: root,
          workspacePath: root,
          homeDir: join(root, "home"),
          dryRun: true,
          overwrite: false,
          fileExists: async () => false,
          skills: [
            {
              record: skillRecord,
              artifacts: [{ ...artifactRecord, path: "../escape.md" }],
            },
          ],
        }),
      ).rejects.toBeInstanceOf(SkillInstallError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

const skillRecord: SkillRecord = {
  skillId: "skill_auth",
  repoId: "atlas",
  sourceDocId: "doc_auth",
  sourceDocPath: "Auth/docs/auth-skill/skill.md",
  title: "Auth Skill",
  description: "Use this skill for authentication workflows.",
  headings: [["Auth Skill"]],
  keySections: ["Follow the authentication workflow."],
  topics: [],
  aliases: [],
  tokenCount: 10,
};

const artifactRecord: SkillArtifactRecord = {
  skillId: "skill_auth",
  path: "references/example.md",
  kind: "reference",
  contentHash: "hash",
  sizeBytes: 8,
  content: "example\n",
};
