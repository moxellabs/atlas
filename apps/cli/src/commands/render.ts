import { CliConsole } from "../io/console";
import { renderTable } from "../io/table";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
/** Builds a human-readable store listing. */
export function renderRows(
  rows: Array<Record<string, string | number | boolean | undefined>>,
): string {
  return renderTable(rows);
}
/** Renders success in human or JSON mode. */
export async function renderSuccess<T>(
  context: CliCommandContext,
  command: string,
  data: T,
  lines: string[] = [],
  exitCode = 0,
): Promise<CliCommandResult<T>> {
  const consoleIo = createCliConsole(context);
  const result = {
    ok: true as const,
    command,
    data,
    ...(exitCode === 0 ? {} : { exitCode }),
  };
  if (context.output.json) {
    await consoleIo.jsonSuccess(result);
  } else {
    const renderedLines =
      lines.length > 0 ? lines : [JSON.stringify(data, null, 2)];
    for (const line of renderedLines) {
      await consoleIo.info(line);
    }
  }
  return result;
}
/** Creates the stream-backed console for one command run. */
export function createCliConsole(context: CliCommandContext): CliConsole {
  return new CliConsole(context.output, context.stdout, context.stderr);
}
