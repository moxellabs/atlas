import { buildIndexedSourceCatalog, discoveryInstructions } from "../discovery/indexed-source-catalog";
import { listIndexedCoverage, listManifests } from "../store-mappers";
import type { AtlasResourceDefinition } from "./resource-utils";

export const MANIFEST_AGENT_GUIDANCE =
	"Use local indexed evidence when it covers the question. Check coverage before relying on it, and use a permitted fallback when coverage is absent or stale.";

/** Stable manifest resource exposing indexed build state. */
export const manifestResource: AtlasResourceDefinition = {
	name: "atlas-manifest",
	uri: "atlas://manifest",
	title: "ATLAS manifest",
	description: "Current indexed manifest state for repositories.",
	read: (_uri, dependencies) => {
		const catalog = buildIndexedSourceCatalog(dependencies);
		return {
		manifests: listManifests(dependencies.db),
		indexedCoverage: listIndexedCoverage(dependencies.db),
		sources: catalog.sources,
		agentGuidance: MANIFEST_AGENT_GUIDANCE,
		instructions: discoveryInstructions(catalog),
		};
	},
};
