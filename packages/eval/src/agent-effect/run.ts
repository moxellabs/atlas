import type {
  AgentArm,
  AgentEffectDataset,
  AgentEffectMetrics,
  AgentEffectPair,
  AgentEffectSnapshot,
  AgentRun,
  JudgedAnswer,
  PairJudgeVerdict,
  RepresentativeTrace,
  RubricCriterionKind,
} from "./types";
import { AGENT_EFFECT_SCHEMA_VERSION } from "./types";

export interface AgentEffectExecutor {
  runAgent(input: {
    readonly arm: AgentArm;
    readonly task: AgentEffectDataset["tasks"][number];
    readonly trial: number;
  }): Promise<AgentRun>;
  judgePair(input: {
    readonly task: AgentEffectDataset["tasks"][number];
    readonly baseline: AgentRun;
    readonly treatment: AgentRun;
    readonly order: readonly AgentArm[];
  }): Promise<PairJudgeVerdict>;
}

export async function runAgentEffectEvaluation(input: {
  readonly dataset: AgentEffectDataset;
  readonly releaseId: string;
  readonly provenance: Omit<
    AgentEffectSnapshot["provenance"],
    "datasetDigest" | "model" | "reasoningEffort"
  >;
  readonly datasetDigest: string;
  readonly executor: AgentEffectExecutor;
}): Promise<AgentEffectSnapshot> {
  const pairs: AgentEffectPair[] = [];
  for (const task of input.dataset.tasks) {
    for (let trial = 1; trial <= input.dataset.runner.trialsPerTask; trial++) {
      const order = pairOrder(task.id, trial);
      const runs = new Map<AgentArm, AgentRun>();
      for (const arm of order) {
        runs.set(arm, await input.executor.runAgent({ arm, task, trial }));
      }
      const baseline = runs.get("baseline");
      const treatment = runs.get("treatment");
      if (baseline === undefined || treatment === undefined) {
        throw new Error(
          `Agent executor did not return both arms for ${task.id}`,
        );
      }
      const judge = await judgeOrMarkUnavailable({
        executor: input.executor,
        task,
        baseline,
        treatment,
        order,
      });
      pairs.push({ taskId: task.id, trial, order, baseline, treatment, judge });
    }
  }
  return {
    schemaVersion: AGENT_EFFECT_SCHEMA_VERSION,
    releaseId: input.releaseId,
    generatedAt: new Date().toISOString(),
    provenance: {
      ...input.provenance,
      datasetDigest: input.datasetDigest,
      model: input.dataset.runner.model,
      reasoningEffort: input.dataset.runner.reasoningEffort,
    },
    dataset: {
      name: input.dataset.name,
      repoId: input.dataset.repoId,
      runner: input.dataset.runner,
    },
    pairs,
    metrics: aggregateAgentEffect(input.dataset, pairs),
    representativeTraces: selectRepresentativeTraces(pairs),
  };
}

export function pairOrder(taskId: string, trial: number): readonly AgentArm[] {
  return stableHash(`${taskId}:${trial}`) % 2 === 0
    ? ["baseline", "treatment"]
    : ["treatment", "baseline"];
}

export function aggregateAgentEffect(
  dataset: AgentEffectDataset,
  pairs: readonly AgentEffectPair[],
): AgentEffectMetrics {
  const baseline = pairs.map((pair) => ({
    run: pair.baseline,
    judged: pair.judge.baseline,
  }));
  const treatment = pairs.map((pair) => ({
    run: pair.treatment,
    judged: pair.judge.treatment,
  }));
  const paired = pairs.reduce(
    (total, pair) => {
      const diff = score(pair.judge.treatment) - score(pair.judge.baseline);
      if (diff > 0) total.wins++;
      else if (diff < 0) total.losses++;
      else total.ties++;
      return total;
    },
    { wins: 0, ties: 0, losses: 0 },
  );
  const treatmentCalls = treatment.flatMap(({ run }) => run.mcp?.calls ?? []);
  const treatmentWithTrace = treatment.filter(
    ({ run }) => run.mcp !== undefined,
  );
  const routingByTask = new Map(
    dataset.tasks.flatMap((task) =>
      task.routing === undefined ? [] : [[task.id, task.routing] as const],
    ),
  );
  const routingRuns = treatment.flatMap(({ run }) => {
    const expectation = routingByTask.get(run.taskId);
    return expectation === undefined ? [] : [{ run, expectation }];
  });
  return {
    pairs: pairs.length,
    baseline: armMetrics(dataset, baseline),
    treatment: armMetrics(dataset, treatment),
    paired,
    mcp: {
      adoptionRate: rate(
        treatment,
        ({ run }) => successfulAtlasCalls(run).length > 0,
      ),
      atlasFirstRate: rate(treatment, ({ run }) => {
        const calls = successfulEvidenceCalls(run);
        return calls.length > 0 && calls[0]?.source === "atlas";
      }),
      localOnlyRate: rate(treatment, ({ run }) => {
        const calls = successfulEvidenceCalls(run);
        return (
          successfulAtlasCalls(run).length > 0 &&
          calls.every((call) => call.source === "atlas")
        );
      }),
      fallbackRate: rate(treatment, ({ run }) =>
        successfulEvidenceCalls(run).some((call) => call.source !== "atlas"),
      ),
      averageCalls:
        treatment.length === 0 ? 0 : treatmentCalls.length / treatment.length,
      protocolErrorRate:
        treatmentWithTrace.length === 0
          ? 0
          : treatmentWithTrace.reduce(
              (total, { run }) => total + (run.mcp?.protocolErrors ?? 0),
              0,
            ) / treatmentWithTrace.length,
    },
    routing: {
      evaluatedRuns: routingRuns.length,
      firstToolSelectionRate: rate(routingRuns, ({ run, expectation }) => {
        const first = successfulEvidenceCalls(run)[0];
        return (
          first !== undefined &&
          expectation.firstTools.includes(evidenceCallKey(first))
        );
      }),
      budgetComplianceRate: rate(
        routingRuns,
        ({ run, expectation }) =>
          successfulAtlasCalls(run).length <= expectation.maxAtlasCalls,
      ),
      fallbackPrecisionRate: rate(routingRuns, ({ run, expectation }) => {
        const usedExternal = successfulEvidenceCalls(run).some(
          (call) => call.source !== "atlas",
        );
        return expectation.externalFallback === "allowed"
          ? true
          : expectation.externalFallback === "required"
            ? usedExternal
            : !usedExternal;
      }),
      redundantCallRate: rate(routingRuns, ({ run, expectation }) =>
        hasRedundantAtlasCalls(run, expectation.allowRepeatedAtlasTools),
      ),
    },
  };
}

/** Enforces a repeated, hermetic, grounded Atlas-discovery result. */
export function assertHermeticAtlasDiscovery(
  snapshot: AgentEffectSnapshot,
  minimumTrialsPerTask = 3,
): void {
  const targetMetrics = snapshot.metrics.mcp;
  const metricFailure =
    targetMetrics.adoptionRate !== 1 ||
    targetMetrics.atlasFirstRate !== 1 ||
    targetMetrics.localOnlyRate !== 1 ||
    targetMetrics.fallbackRate !== 0 ||
    targetMetrics.protocolErrorRate !== 0;
  const trialsByTask = new Map<string, number[]>();
  for (const pair of snapshot.pairs) {
    const trials = trialsByTask.get(pair.taskId) ?? [];
    trials.push(pair.trial);
    trialsByTask.set(pair.taskId, trials);
  }
  const nonConsecutiveTasks = [...trialsByTask].flatMap(([taskId, trials]) => {
    const sorted = [...trials].sort((left, right) => left - right);
    return sorted.length >= minimumTrialsPerTask &&
      sorted.every((trial, index) => trial === index + 1)
      ? []
      : [`${taskId}:${sorted.join(",")}`];
  });
  const failedPairs = snapshot.pairs.filter((pair) => {
    const baselineTrace = pair.baseline.mcp;
    const treatmentTrace = pair.treatment.mcp;
    const successfulCalls = successfulEvidenceCalls(pair.treatment);
    const atlasCalls = successfulAtlasCalls(pair.treatment);
    return (
      pair.treatment.status !== "completed" ||
      baselineTrace === undefined ||
      baselineTrace.protocolErrors !== 0 ||
      treatmentTrace === undefined ||
      treatmentTrace.protocolErrors !== 0 ||
      atlasCalls.length === 0 ||
      successfulCalls[0]?.source !== "atlas" ||
      successfulCalls.some((call) => call.source !== "atlas") ||
      pair.judge.treatment.unsupportedClaimCount !== 0 ||
      pair.judge.treatment.criteria.some((criterion) => !criterion.passed)
    );
  });
  if (
    metricFailure ||
    trialsByTask.size === 0 ||
    nonConsecutiveTasks.length > 0 ||
    failedPairs.length > 0
  ) {
    throw new Error(
      `Atlas discovery gate failed. metrics=${JSON.stringify(targetMetrics)} trials=${nonConsecutiveTasks.join(";") || "ok"} failed=${failedPairs.map((pair) => `${pair.taskId}:${pair.trial}`).join(",") || "none"}.`,
    );
  }
}

/** Enforces dataset-authored first-tool, call-budget, fallback, and redundancy contracts. */
export function assertAgentToolRouting(
  dataset: AgentEffectDataset,
  snapshot: AgentEffectSnapshot,
): void {
  const expectations = new Map(
    dataset.tasks.flatMap((task) =>
      task.routing === undefined ? [] : [[task.id, task.routing] as const],
    ),
  );
  if (expectations.size === 0) {
    throw new Error(
      "Agent routing gate requires at least one routing expectation.",
    );
  }
  const failures = snapshot.pairs.flatMap((pair) => {
    const expectation = expectations.get(pair.taskId);
    if (expectation === undefined) return [];
    const run = pair.treatment;
    const calls = successfulEvidenceCalls(run);
    const first = calls[0];
    const atlasCalls = successfulAtlasCalls(run);
    const usedExternal = calls.some((call) => call.source !== "atlas");
    const reasons: string[] = [];
    if (run.status !== "completed") reasons.push(`status=${run.status}`);
    if ((run.mcp?.protocolErrors ?? 0) !== 0) reasons.push("protocol-errors");
    if (
      first === undefined ||
      !expectation.firstTools.includes(evidenceCallKey(first))
    ) {
      reasons.push(`first=${first?.source ?? "none"}:${first?.name ?? "none"}`);
    }
    if (atlasCalls.length > expectation.maxAtlasCalls) {
      reasons.push(
        `atlas-calls=${atlasCalls.length}>${expectation.maxAtlasCalls}`,
      );
    }
    if (
      (expectation.externalFallback === "required" && !usedExternal) ||
      (expectation.externalFallback === "forbidden" && usedExternal)
    ) {
      reasons.push(`fallback=${usedExternal ? "used" : "not-used"}`);
    }
    if (hasRedundantAtlasCalls(run, expectation.allowRepeatedAtlasTools)) {
      reasons.push("redundant-atlas-call");
    }
    return reasons.length === 0
      ? []
      : [`${pair.taskId}:${pair.trial}[${reasons.join(",")}]`];
  });
  const metrics = snapshot.metrics.routing;
  if (
    metrics.evaluatedRuns === 0 ||
    metrics.firstToolSelectionRate !== 1 ||
    metrics.budgetComplianceRate !== 1 ||
    metrics.fallbackPrecisionRate !== 1 ||
    metrics.redundantCallRate !== 0 ||
    failures.length > 0
  ) {
    throw new Error(
      `Agent routing gate failed. metrics=${JSON.stringify(metrics)} failed=${failures.join(";") || "none"}.`,
    );
  }
}

function hasRedundantAtlasCalls(
  run: AgentRun,
  allowRepeated: boolean | undefined,
): boolean {
  if (allowRepeated === true) return false;
  const seen = new Set<string>();
  return successfulAtlasCalls(run).some((call) => {
    if (seen.has(call.name)) return true;
    seen.add(call.name);
    return false;
  });
}

function evidenceCallKey(call: NonNullable<AgentRun["mcp"]>["calls"][number]) {
  return `${call.source}:${call.name}`;
}

function successfulEvidenceCalls(run: AgentRun) {
  return (run.mcp?.calls ?? []).filter((call) => call.ok);
}

function successfulAtlasCalls(run: AgentRun) {
  return successfulEvidenceCalls(run).filter((call) => call.source === "atlas");
}

export function selectRepresentativeTraces(
  pairs: readonly AgentEffectPair[],
): RepresentativeTrace[] {
  if (pairs.length === 0) return [];
  const scored = pairs.map((pair) => ({
    pair,
    delta: score(pair.judge.treatment) - score(pair.judge.baseline),
  }));
  const byDelta = [...scored].sort(
    (left, right) =>
      right.delta - left.delta ||
      pairKey(left.pair).localeCompare(pairKey(right.pair)),
  );
  const withMcp = [...pairs].sort(
    (left, right) =>
      (right.treatment.mcp?.calls.length ?? 0) -
        (left.treatment.mcp?.calls.length ?? 0) ||
      pairKey(left).localeCompare(pairKey(right)),
  );
  const candidates: Array<
    [RepresentativeTrace["kind"], AgentEffectPair | undefined]
  > = [
    ["largest-win", byDelta[0]?.pair],
    ["median-pair", byDelta[Math.floor(byDelta.length / 2)]?.pair],
    ["largest-loss", byDelta.at(-1)?.pair],
    ["richest-mcp", withMcp[0]],
  ];
  const seen = new Set<string>();
  return candidates.flatMap(([kind, pair]) => {
    if (pair === undefined || seen.has(pairKey(pair))) return [];
    seen.add(pairKey(pair));
    return [{ kind, taskId: pair.taskId, trial: pair.trial }];
  });
}

async function judgeOrMarkUnavailable(input: {
  readonly executor: AgentEffectExecutor;
  readonly task: AgentEffectDataset["tasks"][number];
  readonly baseline: AgentRun;
  readonly treatment: AgentRun;
  readonly order: readonly AgentArm[];
}): Promise<PairJudgeVerdict> {
  if (
    input.baseline.status === "completed" &&
    input.treatment.status === "completed"
  ) {
    return input.executor.judgePair(input);
  }
  return {
    baseline: unavailableVerdict(input.task.criteria, input.baseline.status),
    treatment: unavailableVerdict(input.task.criteria, input.treatment.status),
  };
}

function unavailableVerdict(
  criteria: readonly AgentEffectDataset["tasks"][number]["criteria"][number][],
  status: AgentRun["status"],
): JudgedAnswer {
  return {
    criteria: criteria.map((criterion) => ({
      id: criterion.id,
      passed: false,
      reason: `Agent ${status}; no answer judged.`,
    })),
    unsupportedClaimCount: 0,
  };
}

function armMetrics(
  dataset: AgentEffectDataset,
  entries: ReadonlyArray<{
    readonly run: AgentRun;
    readonly judged: JudgedAnswer;
  }>,
) {
  const criterionKinds = new Map(
    dataset.tasks.flatMap((task) =>
      task.criteria.map((criterion) => [criterion.id, criterion.kind] as const),
    ),
  );
  const expectedKinds = new Map(
    dataset.tasks.map(
      (task) =>
        [
          task.id,
          new Set(task.criteria.map((criterion) => criterion.kind)),
        ] as const,
    ),
  );
  const denominatorFor = (kind: RubricCriterionKind) =>
    entries.filter(({ run }) => expectedKinds.get(run.taskId)?.has(kind));
  const criterionRate = (kind: RubricCriterionKind) => {
    const entriesForKind = denominatorFor(kind);
    return entriesForKind.length === 0
      ? null
      : rate(entriesForKind, ({ judged }) => {
          const verdicts = judged.criteria.filter(
            (criterion) => criterionKinds.get(criterion.id) === kind,
          );
          return (
            verdicts.length > 0 &&
            verdicts.every((criterion) => criterion.passed)
          );
        });
  };
  const grounded = criterionRate("grounding");
  const citation = criterionRate("citation");
  const abstention = criterionRate("abstention");
  return {
    runs: entries.length,
    completionRate: criterionRate("completion") ?? 0,
    groundedAnswerRate: grounded ?? 0,
    citationCoverageRate: citation ?? 0,
    unsupportedClaimRate: rate(
      entries,
      ({ judged }) => judged.unsupportedClaimCount > 0,
    ),
    abstentionCorrectRate: abstention,
    averageDurationMs: average(entries.map(({ run }) => run.durationMs)),
    p95DurationMs: percentile(
      entries.map(({ run }) => run.durationMs),
      0.95,
    ),
  };
}

function score(answer: JudgedAnswer): number {
  return answer.criteria.filter((criterion) => criterion.passed).length;
}

function rate<T>(
  values: readonly T[],
  predicate: (value: T) => boolean,
): number {
  return values.length === 0
    ? 0
    : values.filter(predicate).length / values.length;
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return (
    sorted[
      Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * quantile))
    ] ?? 0
  );
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pairKey(pair: AgentEffectPair): string {
  return `${pair.taskId}:${pair.trial}`;
}
