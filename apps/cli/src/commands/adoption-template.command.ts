import { readBooleanOption, readStringOption } from "../runtime/args";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import {
	buildAdoptionTemplates,
	renderAdoptionTemplateHumanLines,
} from "./adoption-templates";
import { renderSuccess } from "./shared";


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
	const repoInput = context.positionals[0];
	const repoId = readStringOption(context, "repoId");
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
		host: readStringOption(context, "host") ?? parts.host,
		owner: readStringOption(context, "owner") ?? parts.owner,
		name: readStringOption(context, "name") ?? parts.name,
		ref: readStringOption(context, "ref") ?? "main",
	});
	const data = { repoId: resolvedRepoId, adoptionTemplates: templates };
	const lines = renderAdoptionTemplateHumanLines(templates, {
		issueOnly: readBooleanOption(context, "issueOnly"),
		prOnly: readBooleanOption(context, "prOnly"),
		maintainerOnly: readBooleanOption(context, "maintainerOnly"),
	});
	return renderSuccess(context, "adoption-template", data, lines);
}
