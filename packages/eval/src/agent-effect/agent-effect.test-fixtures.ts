import type { AgentEffectDataset } from "./types";

export const dataset: AgentEffectDataset = {
  schemaVersion: 1,
  name: "fixture",
  description: "fixture",
  repoId: "github.com/moxellabs/atlas",
  runner: {
    model: "gpt-5.6-luna",
    reasoningEffort: "high",
    trialsPerTask: 2,
    agentTimeoutMs: 100,
    judgeTimeoutMs: 100,
  },
  tasks: [
    {
      id: "task",
      sourceCaseId: "source",
      title: "Task",
      category: "fixture",
      prompt: "Answer the fixture.",
      criteria: [
        {
          id: "completion",
          kind: "completion",
          description: "complete",
          evidencePaths: ["docs/a.md"],
        },
        {
          id: "grounding",
          kind: "grounding",
          description: "grounded",
          evidencePaths: ["docs/a.md"],
        },
      ],
    },
  ],
};
