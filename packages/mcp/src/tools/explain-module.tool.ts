import { DocRepository, SectionRepository, type DocumentRecord, type ModuleRecord, type SectionRecord, type SummaryRecord } from "@atlas/store";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { McpResourceNotFoundError } from "../errors";
import { toolResult } from "../mcp-result";
import { explainModuleInputSchema, jsonOutputSchema, type ExplainModuleInput } from "../schemas/tool-schemas";
import { getModule, listSkills, listSummaries, provenanceFromDocument } from "../store-mappers";
import type { AtlasMcpDependencies, McpJsonObject } from "../types";

export const EXPLAIN_MODULE_TOOL = "explain_module";

/** Produces a deterministic module explanation from stored summaries and document previews. */
export function executeExplainModule(input: ExplainModuleInput, dependencies: AtlasMcpDependencies): McpJsonObject {
  const parsed = explainModuleInputSchema.parse(input);
  const limit = parsed.limit ?? 5;
  const module = getModule(dependencies.db, parsed.moduleId);
  if (module === undefined) {
    throw new McpResourceNotFoundError("Module was not found.", { operation: "explainModule", entity: parsed.moduleId });
  }

  const documents = new DocRepository(dependencies.db).listByModule(module.moduleId).slice(0, limit);
  const moduleSummaries = listSummaries(dependencies.db, "module", module.moduleId);
  const documentSummaries = documents.flatMap((document) => listSummaries(dependencies.db, "document", document.docId));
  const sections = documents.flatMap((document) => new SectionRepository(dependencies.db).listByDocument(document.docId).map((section) => ({ document, section }))).slice(0, limit);
  const skills = listSkills(dependencies.db, { repoId: module.repoId, moduleId: module.moduleId, limit });

  return {
    module,
    explanation: buildExplanation(module, moduleSummaries, documentSummaries, documents),
    documents: documents.map(presentDocument),
    summaries: {
      module: moduleSummaries,
      documents: documentSummaries.slice(0, limit)
    },
    sections: sections.map(({ document, section }) => presentSectionPreview(document, section)),
    skills,
    provenance: documents.map((document) => provenanceFromDocument(document)),
    diagnostics: [
      {
        stage: "explain_module",
        message: "Built module explanation from stored module-local artifacts.",
        metadata: {
          moduleId: module.moduleId,
          limit,
          documents: documents.length,
          moduleSummaries: moduleSummaries.length,
          documentSummaries: documentSummaries.length,
          sections: sections.length,
          skills: skills.length
        }
      }
    ]
  };
}

/** Registers the explain_module MCP tool. */
export function registerExplainModuleTool(server: McpServer, dependencies: AtlasMcpDependencies): void {
  server.registerTool(
    EXPLAIN_MODULE_TOOL,
    {
      title: "Explain ATLAS module",
      description: "Produce a deterministic module explanation from summaries, docs, sections, skills, and provenance.",
      inputSchema: explainModuleInputSchema,
      outputSchema: jsonOutputSchema
    },
    (input) => toolResult(executeExplainModule(input, dependencies))
  );
}

function buildExplanation(
  module: ModuleRecord,
  moduleSummaries: readonly SummaryRecord[],
  documentSummaries: readonly SummaryRecord[],
  documents: readonly DocumentRecord[]
): string {
  const shortModuleSummary = moduleSummaries.find((summary) => summary.level === "short");
  if (shortModuleSummary !== undefined) {
    return shortModuleSummary.text;
  }
  const firstDocumentSummary = documentSummaries[0];
  if (firstDocumentSummary !== undefined) {
    return firstDocumentSummary.text;
  }
  const titles = documents.flatMap((document) => (document.title === undefined ? [] : [document.title]));
  if (titles.length > 0) {
    return `${module.name} module at ${module.path}. Documented by ${titles.join(", ")}.`;
  }
  return `${module.name} module at ${module.path}. No module summaries or module-local documents are indexed yet.`;
}

function presentDocument(document: DocumentRecord): McpJsonObject {
  return {
    docId: document.docId,
    repoId: document.repoId,
    path: document.path,
    title: document.title,
    kind: document.kind,
    authority: document.authority,
    sourceVersion: document.sourceVersion,
    packageId: document.packageId,
    moduleId: document.moduleId,
    skillId: document.skillId
  };
}

function presentSectionPreview(document: DocumentRecord, section: SectionRecord): McpJsonObject {
  return {
    sectionId: section.sectionId,
    docId: section.docId,
    path: document.path,
    headingPath: section.headingPath,
    ordinal: section.ordinal,
    preview: section.text.slice(0, 240),
    provenance: provenanceFromDocument(document, section.headingPath)
  };
}
