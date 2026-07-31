import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { IndexedSourceCatalogEntry } from "../discovery/indexed-source-catalog";
import { resourceResult } from "../mcp-result";

/** Registers one concrete resource that describes an indexed local source. */
export function registerIndexedSourceResource(
	server: McpServer,
	resourcePrefix: string,
	source: IndexedSourceCatalogEntry,
) {
	const name = `${resourcePrefix}-source-${source.toolSuffix}`;
	const uri = `atlas://source/${encodeURIComponent(source.repoId)}`;
	return {
		name,
		handle: server.registerResource(
			name,
			uri,
			{
				title: `Local documentation: ${source.title}`,
				description: `Indexed local documentation catalog for ${source.title}.`,
				mimeType: "application/json",
			},
			() => resourceResult(uri, indexedSourcePayload(source)),
		),
	};
}

function indexedSourcePayload(source: IndexedSourceCatalogEntry) {
	return {
		repoId: source.repoId,
		title: source.title,
		aliases: source.aliases,
		topics: source.topics,
		documentCount: source.documentCount,
		packageCount: source.packageCount,
		moduleCount: source.moduleCount,
		freshness: source.fresh ? "fresh" : "stale",
		recommendedTool: `plan_context__${source.toolSuffix}`,
	};
}
