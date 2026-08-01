import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import { isUnknownRecord } from "./guards";

import type {
  CodexConfigOperation,
  IntegrationOperation,
  JsonMergeOperation,
  NativeConfigVerification,
  ManagedFileOperation,
} from "./types";

export interface FileBackup {
  readonly path: string;
  readonly existed: boolean;
  readonly content: string;
  readonly applied: string | undefined;
}

export interface PreparedFileChange {
  /** Content observed before planning; the commit aborts if it changed. */
  readonly expected: string | undefined;
  /** Exact content Atlas intends to commit; undefined removes the file. */
  readonly desired: string | undefined;
}

export async function prepareFileOperations(
  operations: readonly IntegrationOperation[],
  initial: ReadonlyMap<string, PreparedFileChange> = new Map(),
): Promise<Map<string, PreparedFileChange>> {
  const nextByPath = new Map(initial);
  for (const operation of operations) {
    if (
      operation.kind !== "json-merge" &&
      operation.kind !== "codex-config" &&
      operation.kind !== "managed-file"
    )
      continue;
    const staged = await stagedContent(operation.path, nextByPath);
    let desired: string;
    if (operation.kind === "json-merge")
      desired = mergeJson(staged.current, operation.keyPath, operation.value);
    else if (operation.kind === "codex-config")
      desired = mergeCodexConfig(staged.current, operation);
    else {
      if (staged.current.length > 0)
        throw new Error(
          `Refusing to overwrite unmanaged configuration file: ${operation.path}.`,
        );
      desired = operation.content;
    }
    nextByPath.set(operation.path, {
      expected: staged.expected,
      desired,
    });
  }
  return nextByPath;
}

export async function prepareRemovalOperations(
  operations: readonly IntegrationOperation[],
): Promise<Map<string, PreparedFileChange>> {
  const nextByPath = new Map<string, PreparedFileChange>();
  for (const operation of [...operations].reverse()) {
    if (
      operation.kind !== "json-merge" &&
      operation.kind !== "codex-config" &&
      operation.kind !== "managed-file"
    )
      continue;
    const staged = await stagedContent(operation.path, nextByPath);
    let desired: string | undefined;
    if (operation.kind === "json-merge")
      desired = removeJson(staged.current, operation.keyPath, operation.value);
    else if (operation.kind === "codex-config")
      desired = removeCodexConfig(staged.current, operation);
    else
      desired =
        staged.current === operation.content ? undefined : staged.current;
    nextByPath.set(operation.path, {
      expected: staged.expected,
      desired,
    });
  }
  return nextByPath;
}

export async function applyPreparedFiles(
  prepared: ReadonlyMap<string, PreparedFileChange>,
): Promise<readonly FileBackup[]> {
  const backups: FileBackup[] = [];
  try {
    for (const [path, change] of prepared) {
      const prior = await readOptional(path);
      if (prior !== change.expected)
        throw new Error(
          `Configuration changed while Atlas was preparing an integration update: ${path}. No stale content was written; retry the command.`,
        );
      if (change.desired === prior) continue;
      if (change.desired === undefined) await rm(path, { force: true });
      else await writeAtomic(path, change.desired);
      backups.push({
        path,
        existed: prior !== undefined,
        content: prior ?? "",
        applied: change.desired,
      });
    }
    return backups;
  } catch (error) {
    await restoreFiles(backups);
    throw error;
  }
}

export async function restoreFiles(
  backups: readonly FileBackup[],
): Promise<void> {
  for (const backup of [...backups].reverse()) {
    const current = await readOptional(backup.path);
    if (current !== backup.applied)
      throw new Error(
        `Configuration changed while Atlas was rolling back an integration update: ${backup.path}. The newer content was preserved.`,
      );
    if (backup.existed) await writeAtomic(backup.path, backup.content);
    else await rm(backup.path, { force: true });
  }
}

export async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

export async function writeAtomic(
  path: string,
  content: string,
): Promise<void> {
  const target = await writableTarget(path);
  await mkdir(dirname(target.path), { recursive: true });
  const temporaryPath = `${target.path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, {
      flag: "wx",
      mode: target.mode,
    });
    await rename(temporaryPath, target.path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function writableTarget(
  path: string,
): Promise<{ readonly path: string; readonly mode: number }> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(path);
  } catch (error) {
    if (isMissingFileError(error)) return { path, mode: 0o600 };
    throw error;
  }
  if (!info.isSymbolicLink()) return { path, mode: info.mode & 0o777 };
  let targetPath: string;
  try {
    targetPath = await realpath(path);
  } catch (error) {
    if (isMissingFileError(error))
      throw new Error(`Configuration symlink is dangling: ${path}.`);
    throw error;
  }
  const targetInfo = await lstat(targetPath);
  if (!targetInfo.isFile())
    throw new Error(`Configuration symlink target is not a file: ${path}.`);
  return { path: targetPath, mode: targetInfo.mode & 0o777 };
}

export async function fileOperationMatches(
  operation: IntegrationOperation | NativeConfigVerification,
): Promise<boolean> {
  if (operation.kind === "manual") return true;
  if (operation.kind === "command") return false;
  const content = await readOptional(operation.path);
  if (content === undefined) return false;
  if (operation.kind === "managed-file") return content === operation.content;
  if (operation.kind === "native-config") {
    const root = parseJsonObject(content);
    const parent = findJsonPath(root, operation.keyPath.slice(0, -1));
    const key = operation.keyPath.at(-1);
    return (
      parent !== undefined &&
      key !== undefined &&
      nativeServerMatches(parent[key], operation.server)
    );
  }
  if (operation.kind === "json-merge") {
    const root = parseJsonObject(content);
    const parent = findJsonPath(root, operation.keyPath.slice(0, -1));
    const key = operation.keyPath.at(-1);
    return (
      parent !== undefined &&
      key !== undefined &&
      deepEqual(parent[key], operation.value)
    );
  }
  const lines = normalizeLines(content);
  const section = findTomlSection(lines, `mcp_servers.${operation.serverName}`);
  if (section === undefined) return false;
  const assignments = new Map<string, string>();
  let duplicateAssignment = false;
  let unexpectedContent = false;
  for (let index = section.start + 1; index < section.end; index += 1) {
    const line = lines[index] ?? "";
    const key = tomlAssignmentKey(line);
    if (key !== undefined) {
      if (assignments.has(key)) duplicateAssignment = true;
      assignments.set(key, line.trim());
    } else if (line.trim().length > 0 && !line.trim().startsWith("#")) {
      unexpectedContent = true;
    }
  }
  const expectedAssignments = codexServerAssignments(operation);
  if (
    duplicateAssignment ||
    unexpectedContent ||
    assignments.size !== expectedAssignments.size ||
    [...expectedAssignments].some(
      ([key, value]) => assignments.get(key) !== value,
    )
  )
    return false;
  return true;
}

function nativeServerMatches(
  value: unknown,
  expected: NativeConfigVerification["server"],
): boolean {
  if (!isUnknownRecord(value) || value.command !== expected.command)
    return false;
  if (
    value.type !== undefined &&
    value.type !== "stdio" &&
    value.type !== "local"
  )
    return false;
  const actualArgs = value.args ?? [];
  if (
    !Array.isArray(actualArgs) ||
    !actualArgs.every((entry) => typeof entry === "string") ||
    !deepEqual(actualArgs, expected.args)
  )
    return false;
  const actualEnv = value.env;
  if (actualEnv === undefined)
    return expected.env === undefined || Object.keys(expected.env).length === 0;
  if (
    !isUnknownRecord(actualEnv) ||
    !Object.values(actualEnv).every((entry) => typeof entry === "string")
  )
    return false;
  return deepEqual(actualEnv, expected.env ?? {});
}

function mergeJson(
  content: string,
  keyPath: readonly string[],
  value: unknown,
): string {
  const root = parseJsonObject(content);
  const parent = ensureJsonPath(root, keyPath.slice(0, -1));
  const key = keyPath.at(-1);
  if (key === undefined) throw new Error("JSON merge key path is empty.");
  if (Object.prototype.hasOwnProperty.call(parent, key)) {
    throw new Error(
      `Refusing to overwrite unmanaged configuration at ${keyPath.join(".")}.`,
    );
  }
  parent[key] = value;
  return `${JSON.stringify(root, null, 2)}\n`;
}

function removeJson(
  content: string,
  keyPath: readonly string[],
  expected: unknown,
): string {
  if (content.length === 0) return content;
  const root = parseJsonObject(content);
  const parent = findJsonPath(root, keyPath.slice(0, -1));
  const key = keyPath.at(-1);
  if (parent === undefined || key === undefined) return content;
  if (deepEqual(parent[key], expected)) delete parent[key];
  return `${JSON.stringify(root, null, 2)}\n`;
}

function parseJsonObject(content: string): Record<string, unknown> {
  if (content.trim().length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Configuration is not valid JSON; refusing a destructive rewrite: ${errorMessage(error)}`,
    );
  }
  if (!isUnknownRecord(parsed))
    throw new Error("Configuration root must be a JSON object.");
  return parsed;
}

function ensureJsonPath(
  root: Record<string, unknown>,
  path: readonly string[],
): Record<string, unknown> {
  let cursor = root;
  for (const key of path) {
    const existing = cursor[key];
    if (existing === undefined) {
      const created: Record<string, unknown> = {};
      cursor[key] = created;
      cursor = created;
    } else if (isUnknownRecord(existing)) cursor = existing;
    else
      throw new Error(
        `Configuration key ${key} is not an object; refusing to replace it.`,
      );
  }
  return cursor;
}

function findJsonPath(
  root: Record<string, unknown>,
  path: readonly string[],
): Record<string, unknown> | undefined {
  let cursor = root;
  for (const key of path) {
    const existing = cursor[key];
    if (!isUnknownRecord(existing)) return undefined;
    cursor = existing;
  }
  return cursor;
}

function mergeCodexConfig(
  content: string,
  operation: CodexConfigOperation,
): string {
  const lines = normalizeLines(content);
  if (
    findTomlSection(lines, `mcp_servers.${operation.serverName}`) !== undefined
  ) {
    throw new Error(
      `Refusing to overwrite unmanaged Codex MCP server '${operation.serverName}'.`,
    );
  }
  const serverAssignments = codexServerAssignments(operation);
  mergeTomlAssignments(
    lines,
    `mcp_servers.${operation.serverName}`,
    serverAssignments,
  );
  return renderToml(lines);
}

function removeCodexConfig(
  content: string,
  operation: CodexConfigOperation,
): string {
  if (content.length === 0) return content;
  const lines = normalizeLines(content);
  const section = findTomlSection(lines, `mcp_servers.${operation.serverName}`);
  if (section !== undefined) {
    const expectedAssignments = codexServerAssignments(operation);
    const actualAssignments = new Map<string, string>();
    let hasUnexpectedContent = false;
    for (let index = section.start + 1; index < section.end; index += 1) {
      const line = lines[index] ?? "";
      const key = tomlAssignmentKey(line);
      if (key !== undefined) actualAssignments.set(key, line.trim());
      else if (line.trim().length > 0 && !line.trim().startsWith("#"))
        hasUnexpectedContent = true;
    }
    const exact =
      !hasUnexpectedContent &&
      actualAssignments.size === expectedAssignments.size &&
      [...expectedAssignments].every(
        ([key, value]) => actualAssignments.get(key) === value,
      );
    if (exact) lines.splice(section.start, section.end - section.start);
  }
  return renderToml(lines);
}

function codexServerAssignments(
  operation: CodexConfigOperation,
): ReadonlyMap<string, string> {
  return new Map([
    ["command", `command = ${JSON.stringify(operation.command)}`],
    ["args", `args = ${JSON.stringify(operation.args)}`],
    ...(operation.env === undefined
      ? []
      : [["env", `env = ${tomlInlineTable(operation.env)}`] as const]),
    ...(operation.discoverable
      ? ([
          ["required", "required = true"],
          [
            "default_tools_approval_mode",
            'default_tools_approval_mode = "writes"',
          ],
        ] as const)
      : []),
  ]);
}

function mergeTomlAssignments(
  lines: string[],
  sectionName: string,
  desired: ReadonlyMap<string, string>,
): void {
  const section = findTomlSection(lines, sectionName);
  if (section === undefined) {
    if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
    lines.push(`[${sectionName}]`, ...desired.values());
    return;
  }
  const replacements = new Set<string>();
  for (let index = section.start + 1; index < section.end; index += 1) {
    const key = tomlAssignmentKey(lines[index] ?? "");
    if (key === undefined || !desired.has(key)) continue;
    if (replacements.has(key))
      throw new Error(`Duplicate TOML key ${key}; refusing to edit.`);
    lines[index] = desired.get(key) ?? lines[index] ?? "";
    replacements.add(key);
  }
  const missing = [...desired]
    .filter(([key]) => !replacements.has(key))
    .map(([, line]) => line);
  lines.splice(section.end, 0, ...missing);
}

function tomlInlineTable(env: Readonly<Record<string, string>>): string {
  const entries = Object.entries(env)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${JSON.stringify(key)} = ${JSON.stringify(value)}`);
  return `{ ${entries.join(", ")} }`;
}

function renderToml(lines: readonly string[]): string {
  return `${lines.join("\n").replace(/\n+$/u, "")}\n`;
}

function findTomlSection(
  lines: readonly string[],
  name: string,
): { start: number; end: number } | undefined {
  const separator = name.lastIndexOf(".");
  const prefix = separator < 0 ? "" : name.slice(0, separator);
  const key = separator < 0 ? name : name.slice(separator + 1);
  const headers = new Set([
    `[${name}]`,
    ...(prefix.length === 0
      ? []
      : [`[${prefix}.${JSON.stringify(key)}]`, `[${prefix}.'${key}']`]),
  ]);
  const matches = lines
    .map((line, index) => (headers.has(line.trim()) ? index : -1))
    .filter((index) => index >= 0);
  if (matches.length > 1)
    throw new Error(`Duplicate TOML section ${name}; refusing to edit.`);
  const start = matches[0];
  if (start === undefined) return undefined;
  const next = lines.findIndex(
    (line, index) => index > start && /^\s*\[.*\]\s*$/u.test(line),
  );
  return { start, end: next < 0 ? lines.length : next };
}

function tomlAssignmentKey(line: string): string | undefined {
  if (line.trimStart().startsWith("#")) return undefined;
  return line.match(/^\s*([A-Za-z0-9_-]+)\s*=/u)?.[1];
}

function normalizeLines(content: string): string[] {
  const normalized = content.replace(/\r\n/gu, "\n").replace(/\n+$/u, "");
  return normalized.length === 0 ? [] : normalized.split("\n");
}

async function stagedContent(
  path: string,
  prepared: ReadonlyMap<string, PreparedFileChange>,
): Promise<{ expected: string | undefined; current: string }> {
  const staged = prepared.get(path);
  if (staged !== undefined)
    return { expected: staged.expected, current: staged.desired ?? "" };
  const expected = await readOptional(path);
  return { expected, current: expected ?? "" };
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    );
  }
  if (!isUnknownRecord(left) || !isUnknownRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && deepEqual(left[key], right[key]),
    )
  );
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ENOENT"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
