/** Renders a deterministic plain-text table for human CLI output. */
export function renderTable(rows: Array<Record<string, string | number | boolean | undefined>>): string {
  if (rows.length === 0) {
    return "(empty)";
  }
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const widths = new Map(
    columns.map((column) => [
      column,
      Math.max(column.length, ...rows.map((row) => stringifyCell(row[column]).length))
    ])
  );

  const header = columns.map((column) => column.padEnd(widths.get(column) ?? column.length)).join("  ");
  const divider = columns.map((column) => "-".repeat(widths.get(column) ?? column.length)).join("  ");
  const body = rows.map((row) => columns.map((column) => stringifyCell(row[column]).padEnd(widths.get(column) ?? column.length)).join("  "));
  return [header, divider, ...body].join("\n");
}

function stringifyCell(value: string | number | boolean | undefined): string {
  if (value === undefined) {
    return "";
  }
  return String(value);
}
