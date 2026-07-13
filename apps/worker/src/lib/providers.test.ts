import { describe, expect, it } from "vitest";
import { isProfessionalEmail } from "./providers";

describe("professional email safeguards", () => {
  it("accepts an employer-domain work email", () => {
    expect(isProfessionalEmail("teacher@ccsd.net", "ccsd.net")).toBe(true);
  });

  it("accepts a subdomain of the verified employer domain", () => {
    expect(isProfessionalEmail("teacher@mail.washoeschools.net", "washoeschools.net")).toBe(true);
  });

  it("rejects consumer email and mismatched domains", () => {
    expect(isProfessionalEmail("teacher@gmail.com", "ccsd.net")).toBe(false);
    expect(isProfessionalEmail("teacher@otherdistrict.org", "ccsd.net")).toBe(false);
    expect(isProfessionalEmail("teacher@ccsd.net", null)).toBe(false);
  });
});
