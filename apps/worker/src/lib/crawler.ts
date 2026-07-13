import { stripHtml } from "@agent-os/shared";
import { nowIso, sha256, uuid } from "./utils";
import { writeActivity } from "./db";
import {
  analyzeNevadaRetirementText,
  getRetirementSignalDefinitionCount,
  type RetirementSearchCategory,
  type RetirementSearchPlan,
} from "./nevada-retirement-intelligence";
import { extractWithParallel, searchWithParallel, type ResearchCandidate } from "./parallel";

const MAX_CRAWL_BYTES = 1_000_000;

interface SourceRow {
  id: string;
  name: string;
  url: string;
  source_type: string;
  robots_policy: string;
  approved: number;
  active: number;
}

export async function crawlApprovedSource(env: Env, sourceId: string, runId: string): Promise<void> {
  const source = await env.DB.prepare("SELECT id, name, url, source_type, robots_policy, approved, active FROM sources WHERE id = ?")
    .bind(sourceId).first<SourceRow>();
  if (!source || !source.approved || !source.active) throw new Error("Source is not approved and active.");

  const target = new URL(source.url);
  if (!["http:", "https:"].includes(target.protocol)) throw new Error("Unsupported source protocol.");
  if (source.robots_policy === "honor" && !(await robotsAllows(target, env.APP_NAME))) {
    await env.DB.prepare("UPDATE sources SET last_status = 'blocked_by_robots', last_crawled_at = ?, updated_at = ? WHERE id = ?")
      .bind(nowIso(), nowIso(), source.id).run();
    throw new Error("robots.txt disallows this crawler.");
  }

  const page = await fetchBestPage(env, target);
  const hash = await sha256(page.text);
  const archiveKey = `crawl/${source.id}/${new Date().toISOString().slice(0, 10)}/${hash}.${page.format === "markdown" ? "md" : "html"}`;
  await env.EVIDENCE.put(archiveKey, page.text, {
    httpMetadata: { contentType: page.format === "markdown" ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8" },
    customMetadata: { sourceId: source.id, sourceUrl: source.url, runId, sha256: hash },
  });

  const text = (page.format === "markdown" ? page.text : stripHtml(page.text)).slice(0, 50_000);
  const signals = analyzeNevadaRetirementText(text, { url: source.url, sourceType: source.source_type });
  for (const signal of signals) {
    const evidenceHash = await sha256(`${hash}:${signal.signalType}:${signal.signalPhrase.toLowerCase()}`);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO signals (
         id, source_id, signal_type, signal_category, title, summary, source_url, source_excerpt,
         evidence_hash, confidence, intent_score, source_reliability_score, final_priority_score,
         verification_status, human_review_required, outreach_eligible, suppression_reason, metadata_json,
         discovered_at, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
    ).bind(
      uuid(), source.id, signal.signalType, signal.category, signal.title, signal.summary,
      source.url, signal.excerpt, evidenceHash, signal.confidence, signal.intentScore,
      signal.sourceReliabilityScore, signal.finalPriorityScore, signal.verificationStatus,
      signal.humanReviewRequired ? 1 : 0, signal.outreachEligible ? 1 : 0,
      signal.suppressionReason, JSON.stringify({ ...signal.metadata, signal_phrase: signal.signalPhrase }), nowIso(),
    ).run();
  }

  await env.DB.batch([
    env.DB.prepare("UPDATE sources SET last_status = 'healthy', last_error = NULL, last_crawled_at = ?, updated_at = ? WHERE id = ?")
      .bind(nowIso(), nowIso(), source.id),
    env.DB.prepare("UPDATE agent_runs SET status = 'completed', output_json = ?, completed_at = ? WHERE id = ?")
      .bind(JSON.stringify({
        archiveKey,
        contentHash: hash,
        signalCount: signals.length,
        scraperCount: getRetirementSignalDefinitionCount(),
        fetchProvider: page.provider,
      }), nowIso(), runId),
  ]);
  await writeActivity(env.DB, {
    actorType: "agent", actorName: "Source Crawler", action: "source.crawled", entityType: "source", entityId: source.id,
    detail: `Multi-crawler fetched ${source.name} with ${page.provider}; ${getRetirementSignalDefinitionCount()} retirement scrapers found ${signals.length} reviewable signal${signals.length === 1 ? "" : "s"}.`,
    severity: "success",
  });
}

export async function discoverWebCandidates(
  env: Env,
  query: string,
  runId: string,
  context: { queryId?: string; category?: RetirementSearchCategory; sourceType?: RetirementSearchPlan["sourceType"] } = {},
): Promise<void> {
  if (!env.TINYFISH_API_KEY && !env.PARALLEL_API_KEY) {
    await env.DB.prepare("UPDATE agent_runs SET status = 'skipped', output_json = ?, completed_at = ? WHERE id = ?")
      .bind(JSON.stringify({ reason: "Neither TINYFISH_API_KEY nor PARALLEL_API_KEY is configured" }), nowIso(), runId).run();
    return;
  }
  const plan: RetirementSearchPlan = {
    id: context.queryId ?? `manual-${await sha256(query).then((value) => value.slice(0, 16))}`,
    category: context.category ?? "district",
    query,
    sourceType: context.sourceType ?? "news",
  };
  const requests: Array<Promise<ResearchCandidate[]>> = [];
  const searchMode = String(env.SEARCH_PROVIDER_MODE || "multi");
  if (searchMode !== "tinyfish" && env.PARALLEL_API_KEY) requests.push(searchWithParallel(env, plan));
  if (searchMode !== "parallel" && env.TINYFISH_API_KEY) requests.push(searchWithTinyFish(env, plan));
  if (requests.length === 0 && env.PARALLEL_API_KEY) requests.push(searchWithParallel(env, plan));
  if (requests.length === 0 && env.TINYFISH_API_KEY) requests.push(searchWithTinyFish(env, plan));
  const settled = await Promise.allSettled(requests);
  const successful = settled.filter((result): result is PromiseFulfilledResult<ResearchCandidate[]> => result.status === "fulfilled");
  if (successful.length === 0) {
    throw new Error(settled.map((result) => result.status === "rejected" ? String(result.reason) : "").filter(Boolean).join("; ") || "All search providers failed.");
  }
  const candidates = dedupeCandidates(successful.flatMap((result) => result.value)).slice(0, 20);
  const providers = [...new Set(candidates.map((item) => item.provider))];
  for (const item of candidates) {
    let url: URL;
    try {
      url = new URL(item.url);
    } catch {
      continue;
    }
    if (!["http:", "https:"].includes(url.protocol)) continue;
    await env.DB.prepare(
      `INSERT OR IGNORE INTO sources (id, name, url, source_type, crawl_frequency, robots_policy, approved, active, last_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'manual', 'honor', 0, 1, 'candidate_review', ?, ?)`,
    ).bind(uuid(), item.title.slice(0, 160), item.url, plan.sourceType, nowIso(), nowIso()).run();
  }
  await env.DB.prepare("UPDATE agent_runs SET status = 'completed', output_json = ?, completed_at = ? WHERE id = ?")
    .bind(JSON.stringify({ candidateCount: candidates.length, providers, queryId: plan.id, category: plan.category }), nowIso(), runId).run();
  await writeActivity(env.DB, {
    actorType: "agent", actorName: "Multi-Provider Source Scout", action: "sources.discovered", entityType: "agent_run", entityId: runId,
    detail: `Parallel/TinyFish search found ${candidates.length} deduplicated public source candidate${candidates.length === 1 ? "" : "s"}; every source requires human approval before crawling.`, severity: "success",
  });
}

async function searchWithTinyFish(env: Env, plan: RetirementSearchPlan): Promise<ResearchCandidate[]> {
  const apiKey = env.TINYFISH_API_KEY;
  if (!apiKey) return [];
  const params = new URLSearchParams({
    query: plan.query,
    purpose: "Find public Nevada education and retirement updates for human review. Do not access private or restricted sources.",
    location: "US",
    language: "en",
    domain_type: "news",
    recency_minutes: "10080",
  });
  const response = await fetch(`${env.TINYFISH_SEARCH_API_BASE}?${params}`, {
    headers: { "X-API-Key": apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`TinyFish Search returned HTTP ${response.status}.`);
  const payload = await response.json<{ results?: Array<{ title?: string; url?: string; snippet?: string; site_name?: string }> }>();
  return (payload.results ?? []).flatMap((item) => item.title && item.url ? [{
    title: item.title,
    url: item.url,
    snippet: item.snippet,
    siteName: item.site_name,
    provider: "tinyfish" as const,
  }] : []);
}

async function fetchBestPage(env: Env, target: URL): Promise<{ text: string; format: "html" | "markdown"; provider: "native" | "tinyfish" | "parallel" }> {
  const mode = String(env.CRAWL_PROVIDER_MODE || "parallel_first");
  const providers: Array<() => Promise<{ text: string; format: "html" | "markdown"; provider: "native" | "tinyfish" | "parallel" }>> = [];
  if (mode !== "tinyfish_first" && env.PARALLEL_API_KEY) providers.push(() => extractWithParallel(env, target.href));
  if (env.TINYFISH_API_KEY) providers.push(() => fetchWithTinyFish(env, target.href));
  if (mode === "tinyfish_first" && env.PARALLEL_API_KEY) providers.push(() => extractWithParallel(env, target.href));
  providers.push(() => fetchNative(env, target));
  const errors: string[] = [];
  for (const provider of providers) {
    try {
      return await provider();
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`All approved-source fetch providers failed: ${errors.join("; ")}`);
}

async function fetchNative(env: Env, target: URL): Promise<{ text: string; format: "html"; provider: "native" }> {
  const response = await fetch(target, {
    headers: { "User-Agent": `${env.APP_NAME}/1.0 (+${env.PUBLIC_APP_URL}/crawler-policy)`, Accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_CRAWL_BYTES) throw new Error("Source response exceeds the configured crawl limit.");
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) throw new Error("Source did not return HTML.");
  return { text: await readBoundedText(response, MAX_CRAWL_BYTES), format: "html", provider: "native" };
}

async function fetchWithTinyFish(env: Env, url: string): Promise<{ text: string; format: "markdown"; provider: "tinyfish" }> {
  const apiKey = env.TINYFISH_API_KEY;
  if (!apiKey) throw new Error("TINYFISH_API_KEY is not configured.");
  const response = await fetch(env.TINYFISH_FETCH_API_BASE, {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ urls: [url], format: "markdown", ttl: 0, include_etag_and_last_modified: true }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`TinyFish Fetch returned HTTP ${response.status}.`);
  const payload = await response.json<{ results?: Array<{ text?: string }>; errors?: Array<{ error?: string }> }>();
  const text = payload.results?.[0]?.text;
  if (!text) throw new Error(payload.errors?.[0]?.error ?? "TinyFish Fetch did not return content.");
  if (new TextEncoder().encode(text).byteLength > MAX_CRAWL_BYTES) throw new Error("TinyFish content exceeds the configured crawl limit.");
  return { text, format: "markdown", provider: "tinyfish" };
}

async function robotsAllows(target: URL, appName: string): Promise<boolean> {
  try {
    const robotsUrl = new URL("/robots.txt", target.origin);
    const response = await fetch(robotsUrl, { headers: { "User-Agent": `${appName}/1.0` }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return true;
    const text = await readBoundedText(response, 128_000);
    let applies = false;
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.split("#", 1)[0]?.trim() ?? "";
      const [rawKey, ...rest] = line.split(":");
      const key = rawKey?.trim().toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") applies = value === "*" || appName.toLowerCase().includes(value.toLowerCase());
      if (applies && key === "disallow" && value && target.pathname.startsWith(value)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("response too large");
      throw new Error("Source response exceeded the configured crawl limit.");
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(combined);
}

function dedupeCandidates(candidates: ResearchCandidate[]): ResearchCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    let key: string;
    try {
      const url = new URL(candidate.url);
      url.hash = "";
      for (const parameter of [...url.searchParams.keys()]) {
        if (/^(utm_|gclid|fbclid)/i.test(parameter)) url.searchParams.delete(parameter);
      }
      key = url.href.replace(/\/$/, "").toLowerCase();
    } catch {
      return false;
    }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
