export interface AdoptionTemplateInput {
	repoId: string;
	repoInput: string;
	host: string;
	owner: string;
	name: string;
	ref: string;
	webUrl?: string | undefined;
	artifactPath?: string | undefined;
}

export interface AdoptionTemplateOutput {
	maintainerInstructions: string;
	issueTemplate: string;
	prTemplate: string;
	commands: string[];
}

const artifactFiles = [
	"manifest.json",
	"corpus.db",
	"checksums.json",
	"docs.index.json",
];

const boundarySentences = [
	"This is a request from a user of this repository, not an automated Atlas action.",
	"Maintainers keep full control over whether to publish Atlas docs, what branch to use, how to review the diff, and when to merge.",
	"Atlas does not branch, commit, push, create issues, or create PRs.",
];

export function buildAdoptionTemplates(
	input: AdoptionTemplateInput,
): AdoptionTemplateOutput {
	const artifactPath = input.artifactPath ?? ".moxel/atlas";
	const repoLabel = input.repoId || input.repoInput;
	const commands = ["atlas init", "atlas build", `git add ${artifactPath}`];
	const fileList = artifactFiles.join(", ");
	const benefits =
		"This helps people who already use this project load its documentation into Atlas without cloning the full repository. The published docs bundle is reproducible, reviewable, and checksum-validated.";
	const boundaryText = boundarySentences.join("\n");
	const workflowGuidance =
		"If this fits the project, use the repository's normal branch naming, commit message, checks, and review process.";

	const maintainerInstructions = [
		`Optional Atlas docs publishing for ${repoLabel}`,
		"",
		`Atlas can read a small docs bundle from ${artifactPath}. The bundle includes ${fileList}.`,
		benefits,
		"",
		"If accepted, suggested commands:",
		...commands.map((command) => `- ${command}`),
		"",
		workflowGuidance,
		boundaryText,
	].join("\n");

	const issueTemplate = [
		`Title: Make ${repoLabel} docs available to Atlas users`,
		"",
		"Request:",
		`Would you consider publishing an Atlas docs bundle under ${artifactPath}?`,
		benefits,
		"",
		`Proposed files: ${fileList}.`,
		"Suggested maintainer commands:",
		...commands.map((command) => `- ${command}`),
		"",
		workflowGuidance,
		boundaryText,
	].join("\n");

	const prTemplate = [
		`PR summary: Make ${repoLabel} docs available to Atlas users`,
		"",
		`This change adds an optional Atlas docs bundle under ${artifactPath}: ${fileList}.`,
		benefits,
		"",
		"Review checklist:",
		...commands.map((command) => `- ${command}`),
		"- Review generated docs bundle diff",
		"- Follow this repository's normal workflow",
		"",
		workflowGuidance,
		boundaryText,
	].join("\n");

	return {
		maintainerInstructions,
		issueTemplate,
		prTemplate,
		commands,
	};
}

export function renderAdoptionTemplateHumanLines(
	templates: AdoptionTemplateOutput,
	filters: {
		issueOnly?: boolean;
		prOnly?: boolean;
		maintainerOnly?: boolean;
	} = {},
): string[] {
	const lines: string[] = [];
	const only = filters.issueOnly || filters.prOnly || filters.maintainerOnly;
	if (!only || filters.maintainerOnly) {
		lines.push(
			"## Optional maintainer steps",
			templates.maintainerInstructions,
			"",
		);
	}
	if (!only || filters.issueOnly) {
		lines.push("## Issue draft", templates.issueTemplate, "");
	}
	if (!only || filters.prOnly) {
		lines.push("## PR draft", templates.prTemplate, "");
	}
	lines.push("## Permissions", ...boundarySentences);
	return lines;
}
