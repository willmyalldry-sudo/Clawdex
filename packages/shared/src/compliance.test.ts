import { describe, expect, it } from "vitest";
import { checkCampaignCompliance } from "./compliance";

describe("campaign compliance", () => {
  it("blocks promissory claims and missing send requirements", () => {
    const result = checkCampaignCompliance({
      subject: "Guaranteed retirement success",
      bodyHtml: "<p>Your plan will earn more.</p>",
      disclosure: "",
      hasPhysicalAddress: false,
      hasUnsubscribeToken: false,
    });
    expect(result.passed).toBe(false);
    expect(result.blockers.length).toBeGreaterThanOrEqual(4);
  });

  it("passes a neutral educational invitation", () => {
    const result = checkCampaignCompliance({
      subject: "Nevada educator retirement checklist",
      bodyHtml: "<p>Hi {{first_name}}, I noticed {{personalization_detail}}.</p><p>Review your 403(b) questions before your next benefits meeting.</p>",
      disclosure: "Educational information only. Not tax or legal advice.",
      hasPhysicalAddress: true,
      hasUnsubscribeToken: true,
      evidenceCount: 1,
    });
    expect(result.passed).toBe(true);
  });

  it("enforces the human-writer subject and personalization rules", () => {
    const result = checkCampaignCompliance({
      subject: "Re: A very long deceptive retirement subject line today",
      bodyHtml: "<p>Hi there. Can we talk? Would tomorrow work?</p>",
      disclosure: "Educational information only. Not tax or legal advice.",
      hasPhysicalAddress: true,
      hasUnsubscribeToken: true,
    });
    expect(result.passed).toBe(false);
    expect(result.blockers).toContain("Keep the subject line to seven words or fewer.");
    expect(result.blockers).toContain("Do not use deceptive reply or forward subject prefixes.");
    expect(result.blockers).toContain("Add the recipient first-name token.");
    expect(result.warnings).toContain("Use one clear call to action.");
  });
});
