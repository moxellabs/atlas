import type { AtlasPromptDefinition } from "./prompt-utils";

/** Prompt for introducing a module from summaries, outlines, and selected sections. */
export const onboardToModulePrompt: AtlasPromptDefinition = {
  name: "onboard_to_module",
  title: "Onboard to module",
  description: "Create a concise module onboarding guide from ATLAS artifacts.",
  text: [
    "Use the provided ATLAS module summaries, outlines, and local sections.",
    "Explain the module purpose, ownership, important documents, common workflows, and likely next files to inspect.",
    "Separate confirmed facts from inferred guidance.",
    "Cite source paths and headings for claims that depend on local documentation."
  ].join("\n")
};
