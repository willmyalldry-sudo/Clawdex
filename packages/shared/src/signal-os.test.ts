import { describe, expect, it } from "vitest";
import { deterministicPreflight, professionalEmailGate, qualifyTeacher } from "./signal-os";

const now = new Date("2026-07-13T18:00:00.000Z");

describe("Signal OS qualification gates", () => {
  it("requires a validated employer-domain work address", () => {
    expect(professionalEmailGate("teacher@gmail.com", "washoeschools.net").passed).toBe(false);
    expect(professionalEmailGate("info@washoeschools.net", "washoeschools.net").passed).toBe(false);
    expect(professionalEmailGate("teacher@washoeschools.net", "washoeschools.net").passed).toBe(true);
  });

  it("qualifies only a current educator tied to fresh evidence", () => {
    const result = qualifyTeacher({
      jobTitle: "Mathematics Teacher", currentDistrict: "Washoe County School District",
      employerDomain: "washoeschools.net", identityConfidence: 0.95, employmentConfidence: 0.94,
      employmentStatus: "verified_current", signalStatus: "active", signalScore: 90,
      signalDate: new Date("2026-07-10T18:00:00.000Z"), evidenceExcerpt: "Ready to Retire workshop",
      sourceUrl: "https://www.washoeschools.net/retirement", email: "teacher@washoeschools.net",
      validationStatus: "valid", validatedAt: new Date("2026-07-12T18:00:00.000Z"),
      isDisposable: false, isRoleAddress: false, isFreeProvider: false, isCatchAll: false,
      isEmployerDomainMatch: true, isSuppressed: false, hasTerminalEvent: false, hasActiveEnrollment: false, now,
    });
    expect(result.qualified).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("cannot bypass suppression or a prior terminal event", () => {
    const result = qualifyTeacher({
      jobTitle: "Teacher", currentDistrict: "Clark County School District", employerDomain: "nv.ccsd.net",
      identityConfidence: 1, employmentConfidence: 1, employmentStatus: "verified_current", signalStatus: "active",
      signalScore: 100, signalDate: now, evidenceExcerpt: "Public retirement announcement", sourceUrl: "https://ccsd.net/public",
      email: "teacher@nv.ccsd.net", validationStatus: "valid", validatedAt: now, isDisposable: false,
      isRoleAddress: false, isFreeProvider: false, isCatchAll: false, isEmployerDomainMatch: true,
      isSuppressed: true, hasTerminalEvent: true, hasActiveEnrollment: false, now,
    });
    expect(result.qualified).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining(["suppressed", "terminal_event_exists"]));
  });
});

describe("deterministic message preflight", () => {
  it("passes a complete signal-specific message", () => {
    const body = "Hi Jamie,\n\nYour district published a Ready to Retire workshop. Would a short Nevada PERS checklist help?\n\nBenjamin Persyn | Appreciation Financial\nEducational information only.\n2485 Village View Dr #190, Henderson, NV 89074\nhttps://example.com/unsubscribe";
    expect(deterministicPreflight({
      subject: "Questions for the district workshop", body, sourceUrl: "https://district.example/events",
      evidenceExcerpt: "Ready to Retire workshop", signalDate: now, emailValidationStatus: "valid",
      validationExpiresAt: new Date("2026-08-01T00:00:00.000Z"), suppressed: false, sequenceActive: true,
      providerAvailable: true, duplicateMessage: false, withinVolumeCaps: true, withinSendingWindow: true,
      senderIdentity: "Benjamin Persyn | Appreciation Financial", disclosure: "Educational information only.",
      postalAddress: "2485 Village View Dr #190, Henderson, NV 89074", unsubscribeUrl: "https://example.com/unsubscribe", now,
    }).passed).toBe(true);
  });

  it("blocks unsupported claims and missing compliance fields", () => {
    const result = deterministicPreflight({
      subject: "You are definitely retiring soon", body: "Your pension value is guaranteed. Call me?",
      sourceUrl: "", evidenceExcerpt: "", signalDate: now, emailValidationStatus: "valid",
      validationExpiresAt: new Date("2026-08-01T00:00:00.000Z"), suppressed: false, sequenceActive: true,
      providerAvailable: true, duplicateMessage: false, withinVolumeCaps: true, withinSendingWindow: true,
      senderIdentity: "Benjamin", disclosure: "Disclosure", postalAddress: "Address", unsubscribeUrl: "https://unsubscribe", now,
    });
    expect(result.passed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining(["prohibited_claim", "signal_evidence_missing", "disclosure_missing", "unsubscribe_missing"]));
  });
});
