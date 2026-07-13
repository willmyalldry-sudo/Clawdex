import { describe, expect, it } from "vitest";
import { classifyMcpRisk, rankMcpCatalog, type McpCatalogEntry } from "./mcp";

const catalog: McpCatalogEntry[] = [
  { id: "gmail", name: "Gmail MCP", sourceUrl: "https://example.com/gmail", category: "Messaging MCP Servers", description: "Read and send email.", tags: ["gmail", "email"], riskLevel: "critical" },
  { id: "arxiv", name: "Arxiv MCP", sourceUrl: "https://example.com/arxiv", category: "API Integration MCP Servers", description: "Search academic papers.", tags: ["research", "papers"], riskLevel: "medium" },
  { id: "chart", name: "Chart MCP", sourceUrl: "https://example.com/chart", category: "Data Visualization", description: "Create charts from data.", tags: ["charts", "visualization"], riskLevel: "low" },
];

describe("MCP catalog routing", () => {
  it("ranks connectors against task language", () => {
    const [match] = rankMcpCatalog("search research papers on teacher retirement", catalog);
    expect(match?.id).toBe("arxiv");
    expect(match?.matchedTerms).toContain("research");
  });

  it("marks consequential capabilities as high risk", () => {
    expect(classifyMcpRisk("execute a crypto token swap")).toBe("critical");
    expect(classifyMcpRisk("manage a production database")).toBe("high");
    expect(classifyMcpRisk("render a chart")).toBe("low");
  });
});
