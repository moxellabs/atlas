import type { DocumentMetadataFilters } from "@atlas/core";
import { lexicalSearch } from "@atlas/store";
import { buildCliDependencies } from "../runtime/dependencies";
import {
	readBooleanOption,
	readStringListOption,
	readStringOption,
} from "../runtime/args";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import { renderRows, renderSuccess } from "./shared";

export async function runSearchCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const query = context.positionals[0];
	if (!query) {
		throw new CliError("search requires a query.", {
			code: "CLI_SEARCH_QUERY_REQUIRED",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	const repoId =
		readStringOption(context, "repo") ??
		readStringOption(context, "repoId");
	const configPath = readStringOption(context, "config");
	const { filters, profileDefaulted, allProfiles } = readSearchFilters(context);
	const deps = await buildCliDependencies({
		cwd: context.cwd,
		env: context.env,
		requireGhesAuth: false,
		...(configPath === undefined ? {} : { configPath }),
	});
	try {
		const hits = lexicalSearch(deps.db, {
			query,
			...(repoId === undefined ? {} : { repoId }),
			filters,
		});
		const rows = hits.map((hit) => ({
			repoId: hit.repoId,
			path: hit.path,
			title: hit.title ?? "",
			docId: hit.docId,
			entityType: hit.entityType,
		}));
		const filterLine = allProfiles
			? "Filters: profile=any (--all-profiles)"
			: profileDefaulted
				? "Filters: profile=public (default)"
				: `Filters: profile=${filters.profile}`;
		return renderSuccess(
			context,
			"search",
			{ query, repoId, filters, profileDefaulted, allProfiles, results: rows },
			rows.length === 0
				? [filterLine, "No results."]
				: [filterLine, renderRows(rows)],
		);
	} finally {
		deps.close();
	}
}

interface SearchFiltersResult {
	filters: DocumentMetadataFilters;
	profileDefaulted: boolean;
	allProfiles: boolean;
}

function readSearchFilters(context: CliCommandContext): SearchFiltersResult {
	const filters: DocumentMetadataFilters = {};
	const profile = readStringOption(context, "profile");
	const allProfiles =
		readBooleanOption(context, "allProfiles") || profile === "any";
	const profileDefaulted = profile === undefined && !allProfiles;
	if (!allProfiles) filters.profile = profile ?? "public";
	const audience = readStringListOption(context, "audience");
	if (audience.length > 0)
		filters.audience = audience as DocumentMetadataFilters["audience"];
	const purpose = readStringListOption(context, "purpose");
	if (purpose.length > 0)
		filters.purpose = purpose as DocumentMetadataFilters["purpose"];
	const visibility = readStringListOption(context, "visibility");
	if (visibility.length > 0)
		filters.visibility = visibility as DocumentMetadataFilters["visibility"];
	return { filters, profileDefaulted, allProfiles };
}

