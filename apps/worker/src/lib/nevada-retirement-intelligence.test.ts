import { describe, expect, it } from "vitest";
import {
  analyzeNevadaRetirementText,
  buildNevadaRetirementSearchCatalog,
  getRetirementSignalDefinitionCount,
  selectNevadaRetirementSearches,
} from "./nevada-retirement-intelligence";

describe("Nevada retirement intelligence", () => {
  it("builds a broad district-specific search catalog", () => {
    const catalog = buildNevadaRetirementSearchCatalog();
    expect(catalog.length).toBeGreaterThan(200);
    expect(catalog.some((item) => item.query.includes("site:ccsd.net") && item.query.includes("board agenda"))).toBe(true);
    expect(catalog.some((item) => item.query.includes("site:irs.gov") && item.query.includes("403(b)"))).toBe(true);
  });

  it("rotates searches deterministically instead of alphabetically", () => {
    const first = selectNevadaRetirementSearches("2026-07-13", 8);
    const repeated = selectNevadaRetirementSearches("2026-07-13", 8);
    const nextDay = selectNevadaRetirementSearches("2026-07-14", 8);
    expect(first).toEqual(repeated);
    expect(nextDay).not.toEqual(first);
    expect(new Set(first.map((item) => item.id)).size).toBe(8);
  });

  it("scores high-intent official NVPERS evidence and requires review", () => {
    const matches = analyzeNevadaRetirementText(
      "NVPERS Ready to Retire Program for Nevada public school educators within one year of retirement.",
      { url: "https://www.nvpers.org/front", sourceType: "retirement" },
    );
    const ready = matches.find((match) => match.signalType === "ready_to_retire_program");
    expect(ready?.finalPriorityScore).toBe(100);
    expect(ready?.humanReviewRequired).toBe(true);
    expect(ready?.outreachEligible).toBe(false);
  });

  it("rejects out-of-state rule-of-80 noise", () => {
    const matches = analyzeNevadaRetirementText(
      "Texas TRS Rule of 80 teacher retirement guidance and DROP program details.",
      { url: "https://example.org/texas-retirement", sourceType: "news" },
    );
    expect(matches).toEqual([]);
  });

  it("runs multiple retirement-specific detectors", () => {
    expect(getRetirementSignalDefinitionCount()).toBeGreaterThan(12);
    const matches = analyzeNevadaRetirementText(
      "A Nevada teacher was recognized for 30 years of service and attended a retirement planning workshop covering 403(b) rollover options.",
      { url: "https://www.ccsd.net/news", sourceType: "district" },
    );
    expect(matches.map((match) => match.signalType)).toEqual(expect.arrayContaining(["service_milestone_30", "retirement_workshop", "403b_457b_planning"]));
  });
});
