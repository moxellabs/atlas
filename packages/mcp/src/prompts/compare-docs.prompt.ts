import type { AtlasPromptDefinition } from "./prompt-utils";

/** Prompt for comparing local documentation with cited ATLAS evidence. */
export const compareDocsPrompt: AtlasPromptDefinition = {
  name: "compare_docs",
  title: "Compare docs",
  description: "Compare local ATLAS documents or scopes with provenance-first grounding.",
  text: [
    "Use ATLAS local corpus tools such as find_docs, read_outline, and read_section to gather comparable evidence.",
    "Compare only documents, sections, or scopes that the retrieved ATLAS context supports.",
    "Separate confirmed similarities, confirmed differences, conflicts, and missing evidence.",
    "Cite document paths, section headings, and provenance for each claim that depends on local documentation.",
    "If the selected context is insufficient, state the narrowest follow-up retrieval needed instead of guessing."
  ].join("\n")
};
