import { describe, expect, it } from "vitest";
import { scoreLabel, scoreLead } from "./scoring";

describe("lead scoring", () => {
  it("prioritizes evidence-backed Nevada educators", () => {
    expect(scoreLead({ state: "NV", title: "High School Teacher", yearsInEducation: 24, signalCount: 2, latestSignalDays: 12, emailStatus: "valid", hasOrganization: true, hasSourceEvidence: true })).toBe(100);
  });

  it("does not infer qualification from missing data", () => {
    expect(scoreLead({})).toBe(0);
    expect(scoreLabel(49)).toBe("developing");
    expect(scoreLabel(50)).toBe("warm");
    expect(scoreLabel(75)).toBe("hot");
  });
});
