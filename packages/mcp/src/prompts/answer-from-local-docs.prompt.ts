import type { AtlasPromptDefinition } from "./prompt-utils";

/** Prompt for answering questions using ATLAS-selected local documentation context. */
export const answerFromLocalDocsPrompt: AtlasPromptDefinition = {
  name: "answer_from_local_docs",
  title: "Answer from local docs",
  description: "Answer a user question from ATLAS context with provenance-first grounding.",
  text: [
    "Use the provided ATLAS context as the evidence source.",
    "Answer only what the selected context supports.",
    "Prefer explicit document paths, section headings, provenance, and authority when explaining the basis for the answer.",
    "If the context is ambiguous or insufficient, say what is missing and suggest the narrowest follow-up query."
  ].join("\n")
};
