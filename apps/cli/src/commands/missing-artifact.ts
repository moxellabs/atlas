import {
	type AdoptionTemplateOutput,
	buildAdoptionTemplates,
	renderAdoptionTemplateHumanLines,
} from "./adoption-templates";

export type MissingArtifactAction =
	| "clone-and-index-local-only"
	| "skip"
	| "show-maintainer-instructions"
	| "generate-issue-pr-instructions";

export interface MissingArtifactFlowInput {
	repoId: string;
	repoInput: string;
	ref: string;
	host: string;
	owner: string;
	name: string;
	nonInteractive: boolean;
	json: boolean;
	selectedAction?: MissingArtifactAction | undefined;
}

export const missingArtifactNextActions: MissingArtifactAction[] = [
	"clone-and-index-local-only",
	"skip",
	"show-maintainer-instructions",
	"generate-issue-pr-instructions",
];

export function buildIndexCommand(input: MissingArtifactFlowInput): string {
	return [
		"atlas",
		"index",
		input.repoInput,
		...repoDisambiguationArgs(input),
		...(input.ref === "main" ? [] : ["--ref", input.ref]),
	]
		.map(shellQuote)
		.join(" ");
}

export function renderMissingArtifactHumanLines(
	input: MissingArtifactFlowInput,
): string[] {
	const command = buildIndexCommand(input);
	const base = ["This repo doesn't publish an Atlas knowledge bundle yet."];
	const adoptionCommand = [
		"atlas",
		"adoption-template",
		input.repoInput,
		...repoDisambiguationArgs(input),
	]
		.map(shellQuote)
		.join(" ");
	const hints = [
		"Try one:",
		`- Local index: ${command}`,
		`- Maintainer request: ${adoptionCommand} --maintainer-only`,
		`- Issue/PR draft: ${adoptionCommand}`,
		`- Interactive: atlas add-repo ${shellQuote(input.repoInput)} -i`,
	];
	if (input.selectedAction === "clone-and-index-local-only")
		return [...base, `Build a local index: ${command}`];
	if (input.selectedAction === "skip")
		return [...base, `Repo not added: ${input.repoId}.`, ...hints];
	if (input.selectedAction === "show-maintainer-instructions")
		return [...base, ...renderMaintainerInstructions(input)];
	if (input.selectedAction === "generate-issue-pr-instructions")
		return [...base, ...renderIssuePrInstructions(input)];
	return base;
}

export function buildMissingArtifactAdoptionTemplates(
	input: MissingArtifactFlowInput,
): AdoptionTemplateOutput {
	return buildAdoptionTemplates({
		repoId: input.repoId,
		repoInput: input.repoInput,
		host: input.host,
		owner: input.owner,
		name: input.name,
		ref: input.ref,
	});
}

export function renderMaintainerInstructions(
	input: MissingArtifactFlowInput,
): string[] {
	return [
		"## Optional maintainer steps",
		buildMissingArtifactAdoptionTemplates(input).maintainerInstructions,
		"## Permissions",
		"This is a request from a user of this repository, not an automated Atlas action.",
		"Maintainers keep full control over whether to publish Atlas docs, what branch to use, how to review the diff, and when to merge.",
		"Atlas does not branch, commit, push, create issues, or create PRs.",
	];
}

export function renderIssuePrInstructions(
	input: MissingArtifactFlowInput,
): string[] {
	return renderAdoptionTemplateHumanLines(
		buildMissingArtifactAdoptionTemplates(input),
	);
}

function repoDisambiguationArgs(input: MissingArtifactFlowInput): string[] {
	if (input.repoInput.split("/").length !== 2) return [];
	return input.host === "github.com" ? [] : ["--host", input.host];
}

function shellQuote(value: string): string {
	if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
	return `'${value.replaceAll("'", `'\\''`)}'`;
}
