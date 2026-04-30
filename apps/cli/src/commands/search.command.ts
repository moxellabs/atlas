import type { DocumentMetadataFilters } from "@atlas/core";
import { lexicalSearch } from "@atlas/store";
import { buildCliDependencies } from "../runtime/dependencies";
import type { CliCommandContext, CliCommandResult } from "../runtime/types";
import { CliError, EXIT_INPUT_ERROR } from "../utils/errors";
import { readArgvString, renderRows, renderSuccess } from "./shared";

export async function runSearchCommand(
	context: CliCommandContext,
): Promise<CliCommandResult> {
	const query = context.argv[0]?.startsWith("--") ? undefined : context.argv[0];
	if (!query) {
		throw new CliError("search requires a query.", {
			code: "CLI_SEARCH_QUERY_REQUIRED",
			exitCode: EXIT_INPUT_ERROR,
		});
	}
	const repoId =
		readArgvString(context.argv, "--repo") ??
		readArgvString(context.argv, "--repo-id");
	const configPath = readArgvString(context.argv, "--config");
	const { filters, profileDefaulted, allProfiles } = readSearchFilters(context.argv);
	const deps = await buildCliDependencies({
		cwd: context.cwd,
		env: context.env,
		requireGhesAuth: false,
		...(configPath === undefined ? {} : { configPath }),
	});
	try {
		if (filters.profile !== undefined && filters.profile !== "public") {
			throw new CliError(
				`Profile ${filters.profile} not available for repo; imported artifact contains public docs only. Use --all-profiles or --profile any to search without a profile filter.`,
				{ code: "CLI_SEARCH_PROFILE_UNAVAILABLE", exitCode: EXIT_INPUT_ERROR },
			);
		}
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

function readSearchFilters(argv: readonly string[]): SearchFiltersResult {
	const filters: DocumentMetadataFilters = {};
	const profile = readArgvString(argv, "--profile");
	const allProfiles = argv.includes("--all-profiles") || profile === "any";
	const profileDefaulted = profile === undefined && !allProfiles;
	if (!allProfiles) filters.profile = profile ?? "public";
	const audience = readRepeatedOption(argv, "--audience");
	if (audience.length > 0)
		filters.audience = audience as DocumentMetadataFilters["audience"];
	const purpose = readRepeatedOption(argv, "--purpose");
	if (purpose.length > 0)
		filters.purpose = purpose as DocumentMetadataFilters["purpose"];
	const visibility = readRepeatedOption(argv, "--visibility");
	if (visibility.length > 0)
		filters.visibility = visibility as DocumentMetadataFilters["visibility"];
	return { filters, profileDefaulted, allProfiles };
}

function readRepeatedOption(argv: readonly string[], flag: string): string[] {
	const values: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		if (argv[index] === flag && argv[index + 1] !== undefined) {
			values.push(argv[index + 1] as string);
		}
	}
	return values;
}
