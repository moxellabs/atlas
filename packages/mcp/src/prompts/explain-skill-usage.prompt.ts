import type { AtlasPromptDefinition } from "./prompt-utils";

/** Prompt for explaining how to use a retrieved ATLAS skill artifact. */
export const explainSkillUsagePrompt: AtlasPromptDefinition = {
  name: "explain_skill_usage",
  title: "Explain skill usage",
  description: "Explain a retrieved ATLAS skill with scope and provenance clarity.",
  text: [
    "Use the retrieved ATLAS skill artifact and its source document context.",
    "Explain when to use the skill, what inputs or scope it assumes, and what output it should produce.",
    "Call out package or module ownership when present.",
    "If the skill data is incomplete, identify the missing fields instead of inventing behavior."
  ].join("\n")
};
