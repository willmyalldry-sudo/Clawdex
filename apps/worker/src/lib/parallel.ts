import {
  PARALLEL_RETIREMENT_DISCOVERY_OBJECTIVE,
  PARALLEL_RETIREMENT_EXTRACTION_OBJECTIVE,
  type RetirementSearchPlan,
} from "./nevada-retirement-intelligence";

export interface ResearchCandidate {
  title: string;
  url: string;
  snippet?: string;
  siteName?: string;
  publishedAt?: string;
  provider: "parallel" | "tinyfish";
}

export async function searchWithParallel(env: Env, plan: RetirementSearchPlan): Promise<ResearchCandidate[]> {
  if (!env.PARALLEL_API_KEY) return [];
  const response = await fetch(`${env.PARALLEL_API_BASE}/search`, {
    method: "POST",
    headers: {
      "x-api-key": env.PARALLEL_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      objective: `${PARALLEL_RETIREMENT_DISCOVERY_OBJECTIVE} Search focus: ${plan.query}`,
      search_queries: [plan.query],
      max_chars_total: 20_000,
      client_model: "benjamin-os",
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Parallel Search returned HTTP ${response.status}.`);
  const payload = await response.json<{
    results?: Array<{ url?: string; title?: string; publish_date?: string; excerpts?: string[] }>;
  }>();
  return (payload.results ?? []).flatMap((item) => {
    if (!item.url || !item.title) return [];
    return [{
      title: item.title,
      url: item.url,
      snippet: item.excerpts?.join(" ").slice(0, 1_500),
      siteName: safeHostname(item.url),
      publishedAt: item.publish_date,
      provider: "parallel" as const,
    }];
  });
}

export async function extractWithParallel(env: Env, url: string): Promise<{ text: string; format: "markdown"; provider: "parallel" }> {
  if (!env.PARALLEL_API_KEY) throw new Error("PARALLEL_API_KEY is not configured.");
  const response = await fetch(`${env.PARALLEL_API_BASE}/extract`, {
    method: "POST",
    headers: {
      "x-api-key": env.PARALLEL_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      urls: [url],
      objective: PARALLEL_RETIREMENT_EXTRACTION_OBJECTIVE,
      search_queries: ["Nevada educator retirement PERS 403(b) 457(b)"],
      max_chars_total: 100_000,
      client_model: "benjamin-os",
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Parallel Extract returned HTTP ${response.status}.`);
  const payload = await response.json<{
    results?: Array<{ excerpts?: string[]; full_content?: string }>;
    errors?: Array<{ content?: string; error_type?: string }>;
  }>();
  const result = payload.results?.[0];
  const text = result?.full_content || result?.excerpts?.join("\n\n") || "";
  if (!text) throw new Error(payload.errors?.[0]?.content ?? payload.errors?.[0]?.error_type ?? "Parallel Extract returned no content.");
  return { text: text.slice(0, 1_000_000), format: "markdown", provider: "parallel" };
}

function safeHostname(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}
