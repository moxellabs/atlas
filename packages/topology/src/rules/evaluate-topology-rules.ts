import type { Authority, DocKind, TopologyRule } from "@atlas/core";
import micromatch from "micromatch";

import { normalizeRepoPath } from "../path-utils";

/** Structured topology rule match for one repo-local path. */
export interface RuleMatch {
  /** Matched topology rule identifier. */
  ruleId: string;
  /** Matched document kind. */
  kind: DocKind;
  /** Authority assigned by the matched rule. */
  authority: Authority;
  /** Rule priority; higher values win primary selection. */
  priority: number;
  /** Original matched topology rule. */
  rule: TopologyRule;
  /** Include/exclude evidence for this match. */
  matchedBy: {
    includePattern: string;
    excludePattern?: string | undefined;
  };
}

/** Options for deterministic topology rule evaluation. */
export interface EvaluateTopologyRulesOptions {
  /** Repository-relative path to evaluate. */
  path: string;
  /** Candidate topology rules. */
  rules: readonly TopologyRule[];
}

/** Evaluates include/exclude topology rules for a path and sorts matches deterministically. */
export function evaluateTopologyRules(options: EvaluateTopologyRulesOptions): RuleMatch[] {
  const path = normalizeRepoPath(options.path);
  const matches: RuleMatch[] = [];

  for (const rule of options.rules) {
    validateTopologyRule(rule);
    const includePattern = rule.match.include.find((pattern) => isMatch(path, pattern));
    if (!includePattern) {
      continue;
    }

    const excludePattern = rule.match.exclude?.find((pattern) => isMatch(path, pattern));
    if (excludePattern) {
      continue;
    }

    matches.push({
      ruleId: rule.id,
      kind: rule.kind,
      authority: rule.authority,
      priority: rule.priority,
      rule,
      matchedBy: {
        includePattern
      }
    });
  }

  return matches.sort((left, right) => right.priority - left.priority || left.ruleId.localeCompare(right.ruleId));
}

/** Returns true when a normalized path matches a topology glob. */
export function isMatch(path: string, pattern: string): boolean {
  return micromatch.isMatch(normalizeRepoPath(path), normalizeRepoPath(pattern), {
    dot: true,
    nocase: false
  });
}

function validateTopologyRule(rule: TopologyRule): void {
  if (rule.id.trim().length === 0 || rule.match.include.length === 0) {
    throw new TopologyRuleError(`Invalid topology rule: ${rule.id || "<missing id>"}`);
  }
}

/** Error raised when a runtime topology rule is structurally invalid. */
export class TopologyRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopologyRuleError";
  }
}
