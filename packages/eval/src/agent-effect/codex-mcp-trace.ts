import { basename } from "node:path";
import type { McpTraceEvent, McpTraceSummary } from "./types";

const FILESYSTEM_COMMANDS: Readonly<Record<string, true>> = {
  cat: true,
  find: true,
  grep: true,
  ls: true,
  pwd: true,
  readlink: true,
  rg: true,
  sed: true,
  stat: true,
};

export function traceMcpEvents(stdout: string): McpTraceSummary {
  const calls: McpTraceEvent[] = [];
  let protocolErrors = 0;
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const rawEvent = JSON.parse(line) as unknown;
      const record =
        typeof rawEvent === "object" &&
        rawEvent !== null &&
        !Array.isArray(rawEvent)
          ? (rawEvent as Record<string, unknown>)
          : undefined;
      const rawItem =
        record?.type === "item.completed" ? record.item : undefined;
      const item =
        typeof rawItem === "object" &&
        rawItem !== null &&
        !Array.isArray(rawItem)
          ? (rawItem as Record<string, unknown>)
          : record;
      if (item !== undefined) {
        const call = traceEvent(item);
        if (call !== undefined) calls.push(call);
      }
    } catch {
      protocolErrors++;
    }
  }
  return { calls, protocolErrors };
}

function traceEvent(
  record: Record<string, unknown>,
): McpTraceEvent | undefined {
  if (
    record.type === "mcp_tool_call" &&
    typeof record.server === "string" &&
    isAtlasEvalServer(record.server)
  ) {
    const name =
      typeof record.tool === "string"
        ? record.tool
        : typeof record.name === "string"
          ? record.name
          : "unknown-tool";
    return {
      kind: "tool",
      name,
      source: "atlas",
      ok: commandSucceeded(record),
    };
  }
  if (record.type === "web_search_call" || record.type === "web_search") {
    return {
      kind: "web_search",
      name: "web_search",
      source: "web",
      ok: commandSucceeded(record),
    };
  }
  if (record.type !== "command_execution") return undefined;
  const command = typeof record.command === "string" ? record.command : "";
  const source = commandSource(command);
  return {
    kind: "command",
    name: evidenceCommandName(command, source),
    source,
    ok: commandSucceeded(record),
  };
}

function isAtlasEvalServer(server: string): boolean {
  return server === "atlas" || server.startsWith("atlas_");
}

function commandSucceeded(record: Record<string, unknown>): boolean {
  return (
    record.error == null &&
    (record.exit_code === undefined || record.exit_code === 0) &&
    record.status !== "failed"
  );
}

function evidenceCommandName(
  command: string,
  source: "shell" | "filesystem" | "github",
): string {
  const names =
    source === "github"
      ? ["gh", "git"]
      : source === "filesystem"
        ? Object.keys(FILESYSTEM_COMMANDS)
        : [];
  return names.length === 0
    ? commandExecutable(command)
    : (embeddedCommand(command, names) ?? commandExecutable(command));
}

function commandSource(command: string): "shell" | "filesystem" | "github" {
  const executable = commandExecutable(command);
  if (
    executable === "gh" ||
    executable === "git" ||
    embeddedCommand(command, ["gh", "git"]) !== undefined
  )
    return "github";
  if (
    Object.hasOwn(FILESYSTEM_COMMANDS, executable) ||
    embeddedCommand(command, Object.keys(FILESYSTEM_COMMANDS)) !== undefined
  )
    return "filesystem";
  return "shell";
}

function commandExecutable(command: string): string {
  const first = command.trim().split(/\s+/, 1)[0];
  return first === undefined || first.length === 0
    ? "unknown-command"
    : basename(first);
}

function embeddedCommand(
  command: string,
  names: readonly string[],
): string | undefined {
  const match = command.match(
    new RegExp(`(?:^|[\\s/'"])(${names.join("|")})(?=[\\s'"]|$)`),
  );
  return match?.[1];
}
