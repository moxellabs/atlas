import type { AtlasPromptDefinition } from "./prompt-utils";

/** Prompt for introducing a repository from ATLAS local corpus artifacts. */
export const onboardToRepoPrompt: AtlasPromptDefinition = {
  name: "onboard_to_repo",
  title: "Onboard to repo",
  description: "Create a concise repository onboarding guide from ATLAS resources.",
  text: [
    "Use ATLAS local corpus resources such as atlas://repo/{repoId}, atlas://package/{packageId}, atlas://module/{moduleId}, atlas://document/{docId}, and atlas://skill/{skillId}.",
    "Explain the repository purpose, package and module structure, important documents, useful skills, and recommended next inspection steps.",
    "Include freshness or stale-state caveats when ATLAS freshness context is provided.",
    "Separate confirmed facts from inferred navigation guidance.",
    "Cite source paths, section headings, and provenance for claims that depend on local documentation."
  ].join("\n")
};
