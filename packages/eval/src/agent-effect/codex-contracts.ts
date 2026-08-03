import { z } from "zod";

import { sanitizeEvalText } from "./sanitize";
import type {
  AgentAnswer,
  AgentEffectTask,
  CriterionVerdict,
  PairJudgeVerdict,
} from "./types";

const citationSchema = z
  .object({ path: z.string(), claim: z.string() })
  .strict();

export const codexAgentOutputSchema = z
  .object({ answer: z.string(), citations: z.array(citationSchema) })
  .strict();

const criterionVerdictSchema = z
  .object({ id: z.string(), passed: z.boolean(), reason: z.string() })
  .strict();

const judgedAnswerSchema = z
  .object({
    criteria: z.array(criterionVerdictSchema),
    unsupportedClaimCount: z.number().int().nonnegative(),
  })
  .strict();

export const codexJudgeOutputSchema = z
  .object({ left: judgedAnswerSchema, right: judgedAnswerSchema })
  .strict();

type CodexJudgeAnswer = z.infer<typeof judgedAnswerSchema>;

export function codexAgentOutputJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(codexAgentOutputSchema) as Record<string, unknown>;
}

export function codexJudgeOutputJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(codexJudgeOutputSchema) as Record<string, unknown>;
}

export function parseCodexAgentAnswer(text: string): AgentAnswer {
  const parsed = JSON.parse(text) as unknown;
  const result = codexAgentOutputSchema.safeParse(parsed);
  if (!result.success) {
    if (
      result.error.issues.some(
        (issue) => issue.path[0] === "citations" && issue.path.length > 1,
      )
    ) {
      throw new Error("Codex agent returned an invalid citation.");
    }
    throw new Error("Codex agent output does not match the answer contract.");
  }
  return {
    answer: sanitizeEvalText(result.data.answer),
    citations: result.data.citations,
  };
}

export function parseCodexJudgeOutput(
  text: string,
  task: AgentEffectTask,
): { left: CodexJudgeAnswer; right: CodexJudgeAnswer } {
  const parsed = JSON.parse(text) as unknown;
  const result = codexJudgeOutputSchema.safeParse(parsed);
  if (!result.success) {
    if (
      result.error.issues.some(
        (issue) =>
          issue.path.length === 0 ||
          ((issue.path[0] === "left" || issue.path[0] === "right") &&
            issue.path.length === 1),
      )
    ) {
      throw new Error("Codex judge output does not match the pair contract.");
    }
    const invalidCriterion = result.error.issues.some(
      (issue) =>
        (issue.path[0] === "left" || issue.path[0] === "right") &&
        issue.path[1] === "criteria" &&
        typeof issue.path[2] === "number",
    );
    throw new Error(
      invalidCriterion
        ? "Codex judge returned an invalid criterion verdict."
        : "Codex judge returned invalid criteria.",
    );
  }
  return {
    left: validateJudgedAnswer(result.data.left, task),
    right: validateJudgedAnswer(result.data.right, task),
  };
}

function validateJudgedAnswer(
  value: CodexJudgeAnswer,
  task: AgentEffectTask,
): CodexJudgeAnswer {
  const criteria = value.criteria.map(
    (criterion): CriterionVerdict => ({
      id: criterion.id,
      passed: criterion.passed,
      reason: sanitizeEvalText(criterion.reason, 500),
    }),
  );
  const expected = task.criteria.map((criterion) => criterion.id).sort();
  if (
    criteria
      .map((criterion) => criterion.id)
      .sort()
      .join("\u0000") !== expected.join("\u0000")
  ) {
    throw new Error(
      "Codex judge did not score every rubric criterion exactly once.",
    );
  }
  return { criteria, unsupportedClaimCount: value.unsupportedClaimCount };
}

export function failedCodexJudgeVerdict(
  task: AgentEffectTask,
  reason: string,
): PairJudgeVerdict {
  const judged = {
    criteria: task.criteria.map((criterion) => ({
      id: criterion.id,
      passed: false,
      reason: sanitizeEvalText(reason, 500),
    })),
    unsupportedClaimCount: 0,
  };
  return { baseline: judged, treatment: judged };
}
