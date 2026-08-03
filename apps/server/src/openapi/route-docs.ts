import { corpusOperationsDocs } from "./operations/corpus-operations";
import { inspectionDocs } from "./operations/inspection";
import { mcpDocs } from "./operations/mcp";
import { repositoryDocs } from "./operations/repositories";
import { retrievalDocs } from "./operations/retrieval";
import { runtimeDocs } from "./operations/runtime";

export { openApiTags } from "./operations/tags";

/** Route details for all documented server endpoints. */
export const docs = {
	...runtimeDocs,
	...repositoryDocs,
	...retrievalDocs,
	...corpusOperationsDocs,
	...inspectionDocs,
	...mcpDocs,
} as const;
