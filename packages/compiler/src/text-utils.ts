/** Normalizes markdown line endings to LF while preserving text content otherwise. */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Collapses whitespace for previews and summaries. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Truncates text at a word boundary when possible. */
export function truncateText(text: string, maxCharacters: number): string {
  if (maxCharacters < 1) {
    throw new TypeError("maxCharacters must be a positive integer.");
  }
  const normalized = collapseWhitespace(text);
  if (normalized.length <= maxCharacters) {
    return normalized;
  }
  const slice = normalized.slice(0, maxCharacters + 1);
  const lastSpace = slice.lastIndexOf(" ");
  const boundary = lastSpace > Math.floor(maxCharacters * 0.6) ? lastSpace : maxCharacters;
  return `${normalized.slice(0, boundary).trimEnd()}...`;
}

/** Returns the first non-empty values from an iterable. */
export function firstNonEmpty(values: Iterable<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized !== undefined && normalized.length > 0) {
      return normalized;
    }
  }
  return undefined;
}

/** Converts a heading path into compact display text. */
export function formatHeadingPath(headingPath: readonly string[]): string {
  return headingPath.join(" > ");
}
