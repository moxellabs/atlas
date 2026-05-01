import type { QueryKind } from "@atlas/core";

import type { QueryClassification } from "../types";

const SIGNALS: readonly SignalRule[] = [
  {
    kind: "skill-invocation",
    signal: "skill-invocation",
    weight: 4,
    patterns: [/\b(use|invoke|run|call|apply)\b.*\bskill\b/i, /\bskill\b.*\b(use|invoke|run|call|apply)\b/i]
  },
  {
    kind: "troubleshooting",
    signal: "troubleshooting",
    weight: 3,
    patterns: [/\b(error|bug|fail(?:ed|ing)?|fix|debug|troubleshoot|why does|not working|broken)\b/i]
  },
  {
    kind: "diff",
    signal: "diff",
    weight: 3,
    patterns: [/\b(what changed|changes?|diff|updated?|modified|regression|since)\b/i]
  },
  {
    kind: "compare",
    signal: "compare",
    weight: 3,
    patterns: [/\b(compare|comparison|difference between|versus| vs\.? )\b/i]
  },
  {
    kind: "location",
    signal: "location",
    weight: 3,
    patterns: [/\b(where is|where are|where do i find|which file|what file|location of|find (?:the )?(?:docs?|section|readme)|read (?:the )?(?:section|docs?))\b/i]
  },
  {
    kind: "usage",
    signal: "usage",
    weight: 3,
    patterns: [/\b(how do i|how can i|how to use|how to|usage|example|examples|configure|configuration|setup|integrate|plan(?:ning)?|retrieve|retrieval|context|mcp|tools?|repo artifact|artifacts?|import|build|publish|init|sync|index|search|sqlite|fts|local|remote|upload|credentials?|tokens?|authentication|authorization)\b/i]
  },
  {
    kind: "overview",
    signal: "overview",
    weight: 2,
    patterns: [/\b(what is|what are|overview|explain|how does|architecture|onboard|introduction)\b/i]
  },
  {
    kind: "exact-lookup",
    signal: "path-or-symbol",
    weight: 4,
    patterns: [/\b[\w.-]+\/[\w./-]+\b/i, /\b[\w.-]+\.(?:md|mdx|ts|tsx|js|jsx|json|yml|yaml)\b/i, /`[^`]+`/]
  }
] as const;

const KIND_PRIORITY: readonly QueryKind[] = [
  "skill-invocation",
  "exact-lookup",
  "location",
  "diff",
  "troubleshooting",
  "usage",
  "compare",
  "overview",
  "unknown"
] as const;

/** Classifies raw query text into a deterministic ATLAS retrieval intent. */
export function classifyQuery(query: string): QueryClassification {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return {
      query,
      kind: "unknown",
      confidence: "low",
      score: 0,
      rationale: ["Query is empty after trimming."],
      signals: []
    };
  }

  const scores = new Map<QueryKind, number>();
  const matchedSignals: string[] = [];
  const rationale: string[] = [];

  for (const rule of SIGNALS) {
    if (rule.patterns.some((pattern) => pattern.test(trimmed))) {
      scores.set(rule.kind, (scores.get(rule.kind) ?? 0) + rule.weight);
      matchedSignals.push(rule.signal);
      rationale.push(`Matched ${rule.signal} signal.`);
    }
  }

  if (looksLikeShortIdentifier(trimmed) && !scores.has("usage") && !scores.has("overview")) {
    scores.set("exact-lookup", (scores.get("exact-lookup") ?? 0) + 2);
    matchedSignals.push("identifier");
    rationale.push("Query looks like a short identifier or symbol.");
  }

  if (scores.has("exact-lookup") && looksLikeNaturalLanguagePathMention(trimmed, scores)) {
    scores.set("exact-lookup", 1);
    rationale.push("Softened path-like exact lookup signal inside a natural-language query.");
  }

  if (matchedSignals.length === 0) {
    return {
      query,
      kind: "unknown",
      confidence: "low",
      score: 0.2,
      rationale: ["No strong retrieval intent signals matched."],
      signals: []
    };
  }

  const kind = chooseKind(scores);
  const topScore = scores.get(kind) ?? 0;
  const totalScore = Array.from(scores.values()).reduce((sum, score) => sum + score, 0);
  const normalized = Math.min(1, topScore / Math.max(4, totalScore));
  return {
    query,
    kind,
    confidence: confidenceFor(topScore, totalScore),
    score: Number(normalized.toFixed(3)),
    rationale: [...rationale, `Selected ${kind} query kind.`],
    signals: matchedSignals
  };
}

interface SignalRule {
  readonly kind: QueryKind;
  readonly signal: string;
  readonly weight: number;
  readonly patterns: readonly RegExp[];
}

function chooseKind(scores: ReadonlyMap<QueryKind, number>): QueryKind {
  return KIND_PRIORITY.reduce<QueryKind>(
    (best, kind) => {
      const score = scores.get(kind) ?? 0;
      const bestScore = scores.get(best) ?? 0;
      return score > bestScore ? kind : best;
    },
    "unknown"
  );
}

function confidenceFor(topScore: number, totalScore: number): QueryClassification["confidence"] {
  if (topScore >= 4 && topScore / totalScore >= 0.55) {
    return "high";
  }
  if (topScore >= 3) {
    return "medium";
  }
  return "low";
}

function looksLikeShortIdentifier(query: string): boolean {
  return /^[\w@./:-]{2,80}$/.test(query) && !/\s/.test(query);
}

function looksLikeNaturalLanguagePathMention(
  query: string,
  scores: ReadonlyMap<QueryKind, number>
): boolean {
  if (!/\s/.test(query) || scores.has("location")) {
    return false;
  }
  return scores.has("usage") || scores.has("overview") || scores.has("troubleshooting") || scores.has("diff") || scores.has("compare");
}
