import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import {
	buildAdoptionTemplates,
	renderAdoptionTemplateHumanLines,
} from "./adoption-templates";
import { readArgvString, renderSuccess } from "./shared";

function firstRepoInput(argv: readonly string[]): string | undefined {
	return argv[0]?.startsWith("--") ? undefined : argv[0];
}

function partsFromRepoId(repoId: string): {
	host: string;
	owner: string;
	name: string;
} {
	const [host = "", owner = "", name = ""] = repoId.split("/");
	return { host, owner, name };
}

export async function runAdoptionTemplateCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const repoInput = firstRepoInput(context.argv);
	const repoId = readArgvString(context.argv, "--repo-id");
	if (!repoInput && !repoId)
		throw new CliError("Repository input or --repo-id is required.", {
			code: "CLI_REPO_ID_REQUIRED",
			exitCode: EXIT_INPUT_ERROR,
		});
	const fallbackId =
		repoInput === undefined
			? undefined
			: repoInput.split("/").length === 2
				? `github.com/${repoInput}`
				: repoInput;
	const resolvedRepoId = repoId ?? fallbackId!;
	const displayRepoInput = repoInput ?? resolvedRepoId;
	const parts = partsFromRepoId(resolvedRepoId);
	const templates = buildAdoptionTemplates({
		repoId: resolvedRepoId,
		repoInput: displayRepoInput,
		host: readArgvString(context.argv, "--host") ?? parts.host,
		owner: readArgvString(context.argv, "--owner") ?? parts.owner,
		name: readArgvString(context.argv, "--name") ?? parts.name,
		ref: readArgvString(context.argv, "--ref") ?? "main",
	});
	const data = { repoId: resolvedRepoId, adoptionTemplates: templates };
	const lines = renderAdoptionTemplateHumanLines(templates, {
		issueOnly: context.argv.includes("--issue-only"),
		prOnly: context.argv.includes("--pr-only"),
		maintainerOnly: context.argv.includes("--maintainer-only"),
	});
	return renderSuccess(context, "adoption-template", data, lines);
}
