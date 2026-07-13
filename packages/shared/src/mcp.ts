export type McpRiskLevel = "low" | "medium" | "high" | "critical";

export interface McpCatalogEntry {
  id: string;
  name: string;
  sourceUrl: string;
  category: string;
  description: string;
  tags: string[];
  riskLevel: McpRiskLevel;
}

export interface RankedMcpCatalogEntry extends McpCatalogEntry {
  score: number;
  matchedTerms: string[];
}

const CRITICAL_TERMS = [
  "trade", "trading", "swap", "wallet", "token transfer", "mint", "revoke", "payment",
  "send email", "send message", "sms", "infrastructure", "deployment", "execute code",
];

const HIGH_TERMS = [
  "blockchain", "crypto", "finance", "market data", "database", "cloud", "devops", "server management",
  "file management", "messaging", "commerce", "repository", "automation", "write", "delete", "publish",
];

const MEDIUM_TERMS = [
  "api integration", "project management", "document management", "monitoring", "browser", "search",
  "data access", "testing", "debugging", "workflow",
];

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into", "is", "it", "of",
  "on", "or", "that", "the", "this", "to", "use", "with", "via", "mcp", "server", "servers", "agent",
]);

export function classifyMcpRisk(input: string): McpRiskLevel {
  const text = normalize(input);
  if (CRITICAL_TERMS.some((term) => text.includes(term))) return "critical";
  if (HIGH_TERMS.some((term) => text.includes(term))) return "high";
  if (MEDIUM_TERMS.some((term) => text.includes(term))) return "medium";
  return "low";
}

export function rankMcpCatalog(
  task: string,
  entries: readonly McpCatalogEntry[],
  limit = 8,
): RankedMcpCatalogEntry[] {
  const terms = tokenize(task);
  if (terms.length === 0) return entries.slice(0, limit).map((entry) => ({ ...entry, score: 0, matchedTerms: [] }));

  return entries
    .map((entry) => {
      const name = normalize(entry.name);
      const category = normalize(entry.category);
      const tags = normalize(entry.tags.join(" "));
      const description = normalize(entry.description);
      const matchedTerms = terms.filter((term) => name.includes(term) || category.includes(term) || tags.includes(term) || description.includes(term));
      const score = matchedTerms.reduce((total, term) => total
        + (name.includes(term) ? 8 : 0)
        + (tags.includes(term) ? 5 : 0)
        + (category.includes(term) ? 3 : 0)
        + (description.includes(term) ? 1 : 0), 0);
      return { ...entry, score, matchedTerms };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, Math.max(1, Math.min(limit, 25)));
}

export function tokenize(input: string): string[] {
  return [...new Set(normalize(input).split(/[^a-z0-9+#.-]+/).filter((term) => term.length > 1 && !STOP_WORDS.has(term)))];
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}
