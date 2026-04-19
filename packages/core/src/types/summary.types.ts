/** Shared summary artifact for repositories, scopes, documents, sections, and skills. */
export interface SummaryArtifact {
  summaryId: string;
  targetType: "repo" | "package" | "module" | "document" | "section" | "skill";
  targetId: string;
  level: "short" | "medium" | "outline";
  text: string;
  tokenCount: number;
}
