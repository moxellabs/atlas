export function cliMcpAdoptionDataset() {
  return {
    name: "cli-mcp-adoption",
    cases: [
      {
        id: "indexed",
        prompt:
          "In the indexed atlas repo, how does plan_context choose evidence?",
        category: "indexed",
        expected: {
          mustCall: [
            { kind: "read_resource", uri: "atlas://manifest" },
            { kind: "call_tool", name: "plan_context" },
          ],
        },
      },
      {
        id: "generic",
        prompt: "What is a good commit message format?",
        category: "generic",
        expected: { mustCall: [{ kind: "no_call" }] },
      },
    ],
  };
}
