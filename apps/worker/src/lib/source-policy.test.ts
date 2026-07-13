import { describe, expect, it } from "vitest";
import { evaluateSourceUrl, robotsAllows } from "./source-policy";

describe("automatic source policy", () => {
  it("allows official Nevada education sources", () => {
    expect(evaluateSourceUrl("https://www.washoeschools.net/Page/1").status).toBe("allowed");
    expect(evaluateSourceUrl("https://www.nvpers.org/news").status).toBe("allowed");
  });

  it("quarantines restricted and social sources", () => {
    expect(evaluateSourceUrl("https://www.facebook.com/groups/private").status).toBe("quarantined");
    expect(evaluateSourceUrl("ftp://example.com/file").status).toBe("rejected");
  });

  it("honors the most specific matching robots rule", () => {
    const robots = "User-agent: *\nDisallow: /private\nAllow: /private/public";
    expect(robotsAllows(robots, "SignalOSBot", "/private/report")).toBe(false);
    expect(robotsAllows(robots, "SignalOSBot", "/private/public/report")).toBe(true);
  });
});
