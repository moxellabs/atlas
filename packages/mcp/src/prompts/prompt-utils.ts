import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Package-local prompt definition consumed by the server composition root. */
export interface AtlasPromptDefinition {
  /** MCP prompt name. */
  name: string;
  /** Human-readable title. */
  title: string;
  /** Prompt description. */
  description: string;
  /** Prompt text template. */
  text: string;
}

/** Registers one static prompt definition on the SDK server. */
export function registerAtlasPrompt(server: McpServer, definition: AtlasPromptDefinition): void {
  server.registerPrompt(
    definition.name,
    {
      title: definition.title,
      description: definition.description
    },
    () => ({
      description: definition.description,
      messages: [
        {
          role: "user",
          content: { type: "text", text: definition.text }
        }
      ]
    })
  );
}
