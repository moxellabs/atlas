import { describe, expect, test } from "bun:test";

import { classifyHealth, HEALTH_THRESHOLDS } from "./health";
import { METRIC_GLOSSARY } from "./metric-glossary";

describe("retrieval report health", () => {
  test("classifyHealth covers higher-is-better and lower-is-better metrics", () => {
    expect(classifyHealth("passRate", 1)).toBe("good");
    expect(classifyHealth("passRate", 0.97)).toBe("warn");
    expect(classifyHealth("passRate", 0.5)).toBe("bad");
    expect(classifyHealth("mrr", 0.7)).toBe("good");
    expect(classifyHealth("mrr", 0.4)).toBe("warn");
    expect(classifyHealth("mrr", 0.1)).toBe("bad");
    expect(classifyHealth("p95LatencyMs", 400)).toBe("good");
    expect(classifyHealth("p95LatencyMs", 900)).toBe("warn");
    expect(classifyHealth("p95LatencyMs", 1500)).toBe("bad");
  });

  test("METRIC_GLOSSARY covers every health metric key with populated targets", () => {
    for (const metric of Object.keys(HEALTH_THRESHOLDS)) {
      const entry = METRIC_GLOSSARY[metric as keyof typeof METRIC_GLOSSARY];
      expect(entry).toBeDefined();
      expect(entry.targets.length).toBeGreaterThan(0);
      expect(entry.short.length).toBeGreaterThan(0);
      expect(entry.interpretation.length).toBeGreaterThan(0);
    }
  });
});
