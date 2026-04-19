import type { AtlasEvalDataset } from "./eval-runner";

export const sampleEvalDataset: AtlasEvalDataset = {
  name: "sample-retrieval",
  cases: [
    {
      id: "session-rotation",
      query: "How do I rotate session tokens?",
      expected: {
        authorities: ["preferred"]
      }
    }
  ]
};
