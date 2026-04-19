import { listIndexedCoverage, listManifests } from "../store-mappers";
import type { AtlasResourceDefinition } from "./resource-utils";

export const MANIFEST_AGENT_GUIDANCE =
	"For questions about an indexed repository, call plan_context before answering from memory.";

/** Stable manifest resource exposing indexed build state. */
export const manifestResource: AtlasResourceDefinition = {
	name: "atlas-manifest",
	uri: "atlas://manifest",
	title: "ATLAS manifest",
	description: "Current indexed manifest state for repositories.",
	read: (_uri, dependencies) => ({
		manifests: listManifests(dependencies.db),
		indexedCoverage: listIndexedCoverage(dependencies.db),
		agentGuidance: MANIFEST_AGENT_GUIDANCE,
	}),
};
