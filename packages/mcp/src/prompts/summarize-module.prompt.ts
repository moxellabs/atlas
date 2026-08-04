import type { AtlasPromptDefinition } from "./prompt-utils";

/** Prompt for summarizing a module from ATLAS summaries, outlines, and sections. */
export const summarizeModulePrompt: AtlasPromptDefinition = {
  name: "summarize_module",
  title: "Summarize module",
  description:
    "Summarize a module from ATLAS module context with cited local evidence.",
  text: [
    "Use plan_context with scope.moduleId for a budgeted module evidence packet; read_document only when one cited document needs an exact section.",
    "Summarize the module responsibilities, important documents, key sections, related skills, and practical usage notes.",
    "Prefer the plan's selected summaries and passages before requesting more evidence.",
    "Cite document paths, section headings, and provenance for claims that depend on local documentation.",
    "If the module context is incomplete, identify the missing documents or sections instead of inventing behavior.",
  ].join("\n"),
};
