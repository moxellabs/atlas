import type { SkillArtifactRecord, SkillRecord } from "@atlas/store";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, normalize, resolve, sep } from "node:path";

export type SkillInstallTarget =
  | "codex"
  | "claude-code"
  | "cursor"
  | "vscode-copilot";
export type SkillInstallScope = "user" | "workspace";

export interface SkillInstallInput {
  target: SkillInstallTarget;
  scope: SkillInstallScope;
  skills: readonly SkillInstallSkill[];
  homeDir: string;
  cwd: string;
  workspacePath?: string | undefined;
  dryRun: boolean;
  overwrite: boolean;
  fileExists(path: string): Promise<boolean>;
}

export interface SkillInstallSkill {
  record: SkillRecord;
  artifacts: readonly SkillArtifactRecord[];
}

export interface SkillInstallResult {
  target: SkillInstallTarget;
  scope: SkillInstallScope;
  dryRun: boolean;
  overwrite: boolean;
  skills: SkillInstallResultSkill[];
  writtenFiles: string[];
  skippedFiles: string[];
  wouldWriteFiles: string[];
  warnings: string[];
}

export interface SkillInstallResultSkill {
  skillId: string;
  title: string;
  destination: string;
  files: string[];
}

export class SkillInstallError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "SkillInstallError";
  }
}

/** Plans and optionally writes discovered ATLAS skills into agent/editor instruction locations. */
export async function installSkills(
  input: SkillInstallInput,
): Promise<SkillInstallResult> {
  if (input.skills.length === 0) {
    throw new SkillInstallError(
      "No skills matched the install selector.",
      "SKILL_INSTALL_EMPTY_SELECTION",
    );
  }

  const files = input.skills.flatMap((skill) => renderSkillFiles(input, skill));
  const writtenFiles: string[] = [];
  const skippedFiles: string[] = [];
  const wouldWriteFiles: string[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    const exists = await input.fileExists(file.path);
    if (exists && !input.overwrite) {
      skippedFiles.push(file.path);
      warnings.push(`Skipped existing file: ${file.path}`);
      continue;
    }
    if (input.dryRun) {
      wouldWriteFiles.push(file.path);
      continue;
    }
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content);
    writtenFiles.push(file.path);
  }

  return {
    target: input.target,
    scope: input.scope,
    dryRun: input.dryRun,
    overwrite: input.overwrite,
    skills: input.skills.map((skill) => {
      const skillFiles = files.filter(
        (file) => file.skillId === skill.record.skillId,
      );
      return {
        skillId: skill.record.skillId,
        title: skill.record.title ?? skill.record.skillId,
        destination: dirname(
          skillFiles[0]?.path ?? resolveDestinationRoot(input),
        ),
        files: skillFiles.map((file) => file.path),
      };
    }),
    writtenFiles,
    skippedFiles,
    wouldWriteFiles,
    warnings,
  };
}

interface PlannedFile {
  skillId: string;
  path: string;
  content: string;
}

function renderSkillFiles(
  input: SkillInstallInput,
  skill: SkillInstallSkill,
): PlannedFile[] {
  const root = resolveDestinationRoot(input);
  const slug = skillSlug(skill.record);
  if (input.target === "cursor") {
    return [
      {
        skillId: skill.record.skillId,
        path: join(root, `${slug}.mdc`),
        content: renderCursorRule(skill.record),
      },
    ];
  }
  if (input.target === "vscode-copilot") {
    return [
      {
        skillId: skill.record.skillId,
        path: join(root, `${slug}.instructions.md`),
        content: renderCopilotInstruction(skill.record),
      },
    ];
  }

  const skillRoot = join(root, slug);
  return [
    {
      skillId: skill.record.skillId,
      path: join(skillRoot, "SKILL.md"),
      content: renderAgentSkill(skill.record),
    },
    ...skill.artifacts
      .filter((artifact) => artifact.content !== undefined)
      .map((artifact) => ({
        skillId: skill.record.skillId,
        path: join(skillRoot, safeRelativePath(artifact.path)),
        content: artifact.content as string,
      })),
  ];
}

function resolveDestinationRoot(input: SkillInstallInput): string {
  if (input.scope === "workspace") {
    const workspacePath = resolve(input.cwd, input.workspacePath ?? input.cwd);
    if (input.target === "codex") {
      return join(workspacePath, ".codex", "skills");
    }
    if (input.target === "claude-code") {
      return join(workspacePath, ".claude", "skills");
    }
    if (input.target === "cursor") {
      return join(workspacePath, ".cursor", "rules");
    }
    return join(workspacePath, ".github", "instructions");
  }

  const home = resolve(input.homeDir);
  if (input.target === "codex") {
    return join(home, ".codex", "skills");
  }
  if (input.target === "claude-code") {
    return join(home, ".claude", "skills");
  }
  if (input.target === "cursor") {
    return join(home, ".cursor", "rules");
  }
  return join(home, ".copilot", "instructions");
}

function renderAgentSkill(skill: SkillRecord): string {
  return [
    "---",
    `name: ${yamlScalar(skillSlug(skill))}`,
    `description: ${yamlScalar(skill.description ?? skill.title ?? skill.sourceDocPath)}`,
    "---",
    "",
    `# ${skill.title ?? skill.skillId}`,
    "",
    provenance(skill),
    "",
    skill.description ?? "",
    "",
    ...skill.keySections,
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n")
    .trimEnd()
    .concat("\n");
}

function renderCursorRule(skill: SkillRecord): string {
  return [
    "---",
    "alwaysApply: false",
    `description: ${yamlScalar(skill.description ?? skill.title ?? skill.sourceDocPath)}`,
    "---",
    "",
    `# ${skill.title ?? skill.skillId}`,
    "",
    provenance(skill),
    "",
    skill.description ?? "",
    "",
    ...skill.keySections,
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n")
    .trimEnd()
    .concat("\n");
}

function renderCopilotInstruction(skill: SkillRecord): string {
  return [
    "---",
    'applyTo: "**"',
    "---",
    "",
    `# ${skill.title ?? skill.skillId}`,
    "",
    provenance(skill),
    "",
    skill.description ?? "",
    "",
    ...skill.keySections,
  ]
    .filter((line, index, lines) => line !== "" || lines[index - 1] !== "")
    .join("\n")
    .trimEnd()
    .concat("\n");
}

function provenance(skill: SkillRecord): string {
  return [
    `ATLAS skill ID: ${skill.skillId}`,
    `Repository: ${skill.repoId}`,
    `Source: ${skill.sourceDocPath}`,
    skill.aliases.length > 0
      ? `Aliases: ${skill.aliases.join(", ")}`
      : undefined,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

function skillSlug(skill: SkillRecord): string {
  const base =
    (skill.title ?? basename(skill.sourceDocPath, ".md")) || skill.skillId;
  return (
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || skill.skillId
  );
}

function safeRelativePath(path: string): string {
  const normalized = normalize(path);
  if (
    normalized.startsWith("..") ||
    normalized.startsWith(sep) ||
    resolve("/", normalized) !== join("/", normalized)
  ) {
    throw new SkillInstallError(
      `Unsafe skill artifact path: ${path}.`,
      "SKILL_INSTALL_UNSAFE_ARTIFACT_PATH",
      { path },
    );
  }
  return normalized;
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}
