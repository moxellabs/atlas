import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
/** Parses `--older-than` into milliseconds. */
export function parseDuration(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value.trim());
  if (!match) {
    throw new CliError(
      `Invalid duration: ${value}. Expected formats like 30m, 12h, or 7d.`,
      {
        code: "CLI_INVALID_DURATION",
        exitCode: EXIT_INPUT_ERROR,
      },
    );
  }
  const amount = Number.parseInt(match[1] ?? "0", 10);
  const unit = match[2];
  const multiplier =
    unit === "ms"
      ? 1
      : unit === "s"
        ? 1000
        : unit === "m"
          ? 60_000
          : unit === "h"
            ? 3_600_000
            : 86_400_000;
  return amount * multiplier;
}
