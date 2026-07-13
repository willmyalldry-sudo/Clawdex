import { NEVADA_SCHOOL_DISTRICTS } from "./nevada-retirement-intelligence";

const NEWS_ALLOWLIST = new Set([
  "reviewjournal.com",
  "nevadacurrent.com",
  "thenevadaindependent.com",
  "kolotv.com",
  "ktnv.com",
  "fox5vegas.com",
  "2news.com",
  "carsonnow.org",
]);

const RESTRICTED_HOSTS = /(?:facebook|instagram|x|twitter|reddit|nextdoor|tiktok)\.com$/i;
const RESTRICTED_PATH = /\/(?:login|signin|account|members?|portal|private|auth)(?:\/|$)/i;

export interface SourcePolicyDecision {
  status: "allowed" | "rejected" | "quarantined";
  reason: string;
  canonicalUrl: string;
  domain: string;
  sourceType: string;
}

export function evaluateSourceUrl(rawUrl: string, suggestedType = "news"): SourcePolicyDecision {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return rejected(rawUrl, "invalid_url"); }
  if (!['http:', 'https:'].includes(url.protocol)) return rejected(rawUrl, "unsupported_protocol");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();
  const domain = url.hostname.replace(/^www\./, "");
  const canonicalUrl = url.href.replace(/\/$/, "");
  if (RESTRICTED_HOSTS.test(domain) || RESTRICTED_PATH.test(url.pathname)) {
    return { status: "quarantined", reason: "restricted_or_social_source", canonicalUrl, domain, sourceType: suggestedType };
  }
  const district = NEVADA_SCHOOL_DISTRICTS.find((item) => domain === item.domain || domain.endsWith(`.${item.domain}`));
  const official = district
    || domain === "nvpers.org" || domain.endsWith(".nvpers.org")
    || domain.endsWith(".nv.gov") || domain === "nv.gov"
    || domain === "leg.state.nv.us"
    || domain.endsWith(".k12.nv.us")
    || domain.endsWith(".edu")
    || domain === "irs.gov" || domain.endsWith(".irs.gov");
  if (official) {
    return { status: "allowed", reason: district ? "verified_nevada_district_domain" : "official_public_domain", canonicalUrl, domain, sourceType: district ? "district" : suggestedType };
  }
  if (NEWS_ALLOWLIST.has(domain) || [...NEWS_ALLOWLIST].some((allowed) => domain.endsWith(`.${allowed}`))) {
    return { status: "allowed", reason: "reputable_public_news_allowlist", canonicalUrl, domain, sourceType: "news" };
  }
  return { status: "quarantined", reason: "domain_class_not_approved", canonicalUrl, domain, sourceType: suggestedType };
}

function rejected(rawUrl: string, reason: string): SourcePolicyDecision {
  return { status: "rejected", reason, canonicalUrl: rawUrl.slice(0, 2_000), domain: "", sourceType: "unknown" };
}

export async function robotsDecision(target: URL, userAgent: string): Promise<{ allowed: boolean; status: "allowed" | "disallowed" | "unavailable" }> {
  try {
    const response = await fetch(new URL("/robots.txt", target.origin), {
      headers: { "User-Agent": userAgent, Accept: "text/plain" },
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 404) return { allowed: true, status: "unavailable" };
    if (!response.ok) return { allowed: false, status: "unavailable" };
    const text = (await response.text()).slice(0, 128_000);
    const allowed = robotsAllows(text, userAgent, target.pathname);
    return { allowed, status: allowed ? "allowed" : "disallowed" };
  } catch {
    return { allowed: false, status: "unavailable" };
  }
}

export function robotsAllows(text: string, userAgent: string, targetPath: string): boolean {
  let applies = false;
  let mostSpecific: { length: number; allowed: boolean } | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*$/, "").trim();
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      const key = line.slice(0, separator).trim().toLowerCase();
      const value = line.slice(separator + 1).trim();
      if (key === "user-agent") {
        const agent = value.toLowerCase();
        applies = agent === "*" || userAgent.toLowerCase().includes(agent);
        continue;
      }
      if (!applies || !value || (key !== "allow" && key !== "disallow")) continue;
      const path = value.split(/[?$]/, 1)[0] ?? "";
      if (path && targetPath.startsWith(path) && (!mostSpecific || path.length >= mostSpecific.length)) {
        mostSpecific = { length: path.length, allowed: key === "allow" };
      }
  }
  return mostSpecific?.allowed ?? true;
}
