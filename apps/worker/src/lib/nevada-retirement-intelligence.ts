export type RetirementSearchCategory =
  | "eligibility"
  | "district"
  | "board_records"
  | "events"
  | "service_milestone"
  | "legislation"
  | "workforce"
  | "benefits"
  | "financial_planning"
  | "public_professional"
  | "official_guidance";

export interface RetirementSearchPlan {
  id: string;
  category: RetirementSearchCategory;
  query: string;
  sourceType: "district" | "school" | "news" | "retirement" | "benefits";
}

export interface RetirementSignalMatch {
  signalType: string;
  category: RetirementSearchCategory;
  title: string;
  summary: string;
  signalPhrase: string;
  excerpt: string;
  intentScore: number;
  sourceReliabilityScore: number;
  finalPriorityScore: number;
  confidence: number;
  metadata: Record<string, string | number | null>;
  verificationStatus: "pending_human_review";
  humanReviewRequired: true;
  outreachEligible: false;
  suppressionReason: string;
}

interface District {
  name: string;
  domain: string;
}

interface SignalDefinition {
  signalType: string;
  category: RetirementSearchCategory;
  title: string;
  summary: string;
  intentScore: number;
  patterns: RegExp[];
}

export const NEVADA_SCHOOL_DISTRICTS: readonly District[] = [
  { name: "Carson City School District", domain: "carsoncityschools.com" },
  { name: "Churchill County School District", domain: "churchillcsd.com" },
  { name: "Clark County School District", domain: "ccsd.net" },
  { name: "Douglas County School District", domain: "dcsd.net" },
  { name: "Elko County School District", domain: "ecsdnv.net" },
  { name: "Esmeralda County School District", domain: "esmeralda.k12.nv.us" },
  { name: "Eureka County School District", domain: "eureka.k12.nv.us" },
  { name: "Humboldt County School District", domain: "hcsdnv.com" },
  { name: "Lander County School District", domain: "lander.k12.nv.us" },
  { name: "Lincoln County School District", domain: "lcsdnv.com" },
  { name: "Lyon County School District", domain: "lyoncsd.org" },
  { name: "Mineral County School District", domain: "nvmcsd.org" },
  { name: "Nye County School District", domain: "nye.k12.nv.us" },
  { name: "Pershing County School District", domain: "pcsdnv.com" },
  { name: "Storey County School District", domain: "storeynv.com" },
  { name: "Washoe County School District", domain: "washoeschools.net" },
  { name: "White Pine County School District", domain: "whitepine.k12.nv.us" },
] as const;

const DISTRICT_SEARCH_TEMPLATES: ReadonlyArray<{
  id: string;
  category: RetirementSearchCategory;
  suffix: string;
}> = [
  { id: "retirement", category: "district", suffix: "retirement" },
  { id: "pers", category: "eligibility", suffix: "Nevada PERS" },
  { id: "seminar", category: "events", suffix: "retirement seminar workshop" },
  { id: "recognition", category: "service_milestone", suffix: "retirement recognition retirees" },
  { id: "personnel", category: "board_records", suffix: "personnel retirement" },
  { id: "agenda", category: "board_records", suffix: "board agenda retirement" },
  { id: "service", category: "service_milestone", suffix: "30 years service retiring teacher" },
  { id: "incentive", category: "workforce", suffix: "early retirement incentive" },
  { id: "rif", category: "workforce", suffix: "reduction in force retirement" },
  { id: "benefits", category: "benefits", suffix: "retiree health benefits Medicare" },
  { id: "pdf", category: "board_records", suffix: "filetype:pdf retirement personnel" },
] as const;

const STATIC_SEARCHES: readonly RetirementSearchPlan[] = [
  { id: "nvpers-eligibility", category: "eligibility", query: "Nevada PERS retirement eligibility", sourceType: "retirement" },
  { id: "nvpers-ready", category: "events", query: "NVPERS Ready to Retire Program", sourceType: "retirement" },
  { id: "nvpers-planning", category: "events", query: "NVPERS Planning Ahead retirement", sourceType: "retirement" },
  { id: "nvpers-estimate", category: "financial_planning", query: "Nevada PERS benefit estimate calculator", sourceType: "retirement" },
  { id: "nvpers-service-credit", category: "financial_planning", query: "Nevada PERS purchase service credit", sourceType: "retirement" },
  { id: "nvpers-reemployment", category: "benefits", query: "Nevada PERS reemployment 90 days", sourceType: "retirement" },
  { id: "nvpers-contribution", category: "legislation", query: "Nevada PERS contribution rate change", sourceType: "retirement" },
  { id: "nvpers-cola", category: "legislation", query: "Nevada PERS COLA post-retirement increase", sourceType: "retirement" },
  { id: "nv-legislation", category: "legislation", query: "site:leg.state.nv.us PERS retirement", sourceType: "retirement" },
  { id: "nv-nrs-286", category: "legislation", query: "site:leg.state.nv.us NRS 286 retirement", sourceType: "retirement" },
  { id: "nv-board-retirement", category: "board_records", query: "Nevada school board retirement personnel", sourceType: "district" },
  { id: "nv-retirement-application", category: "board_records", query: "Nevada educator retirement application effective date", sourceType: "district" },
  { id: "nv-retiring-teacher", category: "public_professional", query: "Nevada teacher retiring end school year", sourceType: "news" },
  { id: "nv-retirement-celebration", category: "public_professional", query: "Nevada district teacher retirement celebration", sourceType: "news" },
  { id: "nv-service-25", category: "service_milestone", query: "Nevada educator 25 years service award", sourceType: "news" },
  { id: "nv-service-30", category: "service_milestone", query: "Nevada teacher 30 years service", sourceType: "news" },
  { id: "nv-service-33", category: "service_milestone", query: "Nevada educator 33 years service", sourceType: "news" },
  { id: "nv-budget", category: "workforce", query: "Nevada school district budget deficit", sourceType: "news" },
  { id: "nv-rif", category: "workforce", query: "Nevada school reduction in force", sourceType: "news" },
  { id: "nv-incentive", category: "workforce", query: "Nevada school early retirement incentive", sourceType: "news" },
  { id: "nv-union", category: "events", query: "Nevada education association retirement workshop", sourceType: "benefits" },
  { id: "nv-benefits-fair", category: "events", query: "Nevada educator benefits fair retirement", sourceType: "benefits" },
  { id: "nv-retiree-health", category: "benefits", query: "Nevada educator retiree health Medicare", sourceType: "benefits" },
  { id: "nv-403b", category: "financial_planning", query: "Nevada teacher 403(b) retirement planning", sourceType: "benefits" },
  { id: "nv-457b", category: "financial_planning", query: "Nevada educator 457(b) retirement", sourceType: "benefits" },
  { id: "nv-rollover", category: "financial_planning", query: "Nevada teacher 403(b) rollover retirement", sourceType: "benefits" },
  { id: "irs-403b", category: "official_guidance", query: "site:irs.gov 403(b) public schools updates", sourceType: "benefits" },
  { id: "irs-401k", category: "official_guidance", query: "site:irs.gov 401(k) contribution limits", sourceType: "benefits" },
  { id: "irs-catchup", category: "official_guidance", query: "site:irs.gov retirement catch-up contributions", sourceType: "benefits" },
  { id: "nv-pdf-retirement", category: "board_records", query: "filetype:pdf Nevada school retirement personnel", sourceType: "district" },
  { id: "nv-pdf-incentive", category: "workforce", query: "filetype:pdf Nevada school early retirement incentive", sourceType: "district" },
  { id: "nv-pdf-service", category: "service_milestone", query: "filetype:pdf Nevada educator years service retirement", sourceType: "district" },
  { id: "k12-retirement", category: "district", query: "site:*.k12.nv.us retirement", sourceType: "district" },
  { id: "k12-pers", category: "eligibility", query: "site:*.k12.nv.us PERS", sourceType: "district" },
  { id: "edu-nvpers", category: "eligibility", query: "site:*.edu \"Nevada PERS\"", sourceType: "district" },
  { id: "nvgov-pers", category: "official_guidance", query: "site:nv.gov \"Nevada PERS\"", sourceType: "retirement" },
  { id: "nvgov-teacher-retirement", category: "official_guidance", query: "site:nv.gov teacher retirement", sourceType: "retirement" },
  { id: "nvpers-org-retirement", category: "official_guidance", query: "site:nvpers.org retirement", sourceType: "retirement" },
  { id: "pdf-ready-to-retire", category: "events", query: "filetype:pdf \"Ready to Retire\" NVPERS", sourceType: "retirement" },
  { id: "pdf-retirement-resignation", category: "board_records", query: "filetype:pdf \"retirement resignation\" Nevada school", sourceType: "district" },
  { id: "pdf-retirement-application", category: "board_records", query: "filetype:pdf \"retirement application\" Nevada PERS", sourceType: "retirement" },
  { id: "nsea-workshop", category: "events", query: "NSEA retirement workshop", sourceType: "benefits" },
  { id: "nsea-pers", category: "eligibility", query: "NSEA PERS", sourceType: "benefits" },
  { id: "notice-intent-retire", category: "board_records", query: "\"notice of intent to retire\" Nevada school", sourceType: "district" },
] as const;

const SIGNAL_DEFINITIONS: readonly SignalDefinition[] = [
  {
    signalType: "retirement_application",
    category: "board_records",
    title: "Documented retirement application or paperwork",
    summary: "A public source contains retirement-application, paperwork, or board-acceptance language. Verify identity, employer, and effective date.",
    intentScore: 98,
    patterns: [/retirement application (?:submitted|received|approved)/i, /submitted (?:my |their )?retirement paperwork/i, /board (?:accepts?|approved?) .{0,60}retirement/i, /notice of retirement submitted/i],
  },
  {
    signalType: "retirement_effective_date",
    category: "board_records",
    title: "Public retirement effective date",
    summary: "A public source states a retirement effective date or final employment date. Human verification is required.",
    intentScore: 96,
    patterns: [/retirement effective (?:date|on|june|july)/i, /retir(?:e|ing|ement).{0,50}(?:end of (?:the )?school year|june 30|july 1|final day|last day)/i],
  },
  {
    signalType: "ready_to_retire_program",
    category: "events",
    title: "NVPERS Ready to Retire signal",
    summary: "A public source references the NVPERS Ready to Retire program, a high-intent education signal.",
    intentScore: 95,
    patterns: [/ready to retire program/i, /within one year of retirement.{0,80}NVPERS/i],
  },
  {
    signalType: "service_milestone_33",
    category: "service_milestone",
    title: "33-year Nevada educator service milestone",
    summary: "A public source indicates approximately 33 or 33⅓ years of service. Eligibility still depends on enrollment cohort and verified facts.",
    intentScore: 88,
    patterns: [/(?:33(?:\.3|\s*1\/3|⅓)?|thirty-three) years? (?:of )?service/i],
  },
  {
    signalType: "service_milestone_30",
    category: "service_milestone",
    title: "30-year Nevada educator service milestone",
    summary: "A public source indicates 30 years of service. Do not infer eligibility without enrollment-cohort and age verification.",
    intentScore: 84,
    patterns: [/(?:30|thirty) years? (?:of )?(?:service|teaching|education)/i],
  },
  {
    signalType: "service_credit_purchase",
    category: "financial_planning",
    title: "PERS service-credit purchase planning",
    summary: "A public source discusses purchasing, restoring, or repaying Nevada PERS service credit.",
    intentScore: 82,
    patterns: [/(?:purchase|buy|restore|repay).{0,45}(?:PERS )?service credit/i, /service credit (?:purchase|restoration|repayment)/i],
  },
  {
    signalType: "retirement_announcement",
    category: "public_professional",
    title: "Public educator retirement announcement",
    summary: "A public professional or employer source appears to announce an educator's retirement. Confirm that it is not a transfer, resignation, or non-renewal.",
    intentScore: 90,
    patterns: [/(?:teacher|educator|principal|superintendent|school employee).{0,80}(?:announc(?:es|ed) (?:plans to )?retire|is retiring|will retire)/i, /retiring (?:teacher|educator|principal|superintendent)/i],
  },
  {
    signalType: "benefit_estimate",
    category: "financial_planning",
    title: "Nevada PERS benefit-estimate planning",
    summary: "A public source references a PERS benefit estimate, calculation, or unreduced-retirement review.",
    intentScore: 72,
    patterns: [/(?:Nevada PERS|NVPERS).{0,45}(?:benefit estimate|benefit estimator|retirement calculator|unreduced benefit|early retirement reduction)/i],
  },
  {
    signalType: "retirement_workshop",
    category: "events",
    title: "Retirement workshop or counseling signal",
    summary: "A public source advertises or documents retirement education, counseling, or a benefits event for Nevada educators.",
    intentScore: 66,
    patterns: [/(?:pre-?retirement|retirement planning|retirement readiness).{0,30}(?:seminar|workshop|webinar|orientation|counseling|presentation)/i, /NVPERS.{0,40}(?:seminar|workshop|counseling|presentation)/i],
  },
  {
    signalType: "403b_457b_planning",
    category: "financial_planning",
    title: "Educator supplemental-plan retirement planning",
    summary: "A public source discusses 403(b), 457(b), or rollover planning in a Nevada educator retirement context.",
    intentScore: 62,
    patterns: [/(?:403\s?\(b\)|403b|457\s?\(b\)|457b).{0,60}(?:retire|rollover|distribution|service credit|catch-up)/i, /(?:retire|rollover|distribution).{0,60}(?:403\s?\(b\)|403b|457\s?\(b\)|457b)/i],
  },
  {
    signalType: "retiree_health_transition",
    category: "benefits",
    title: "Retiree health or Medicare transition",
    summary: "A public source discusses retiree health coverage, PEBP, or Medicare transition for Nevada public employees.",
    intentScore: 60,
    patterns: [/(?:retiree health|health (?:insurance|benefits) after retirement|Medicare transition|PEBP retiree)/i],
  },
  {
    signalType: "post_retirement_employment",
    category: "benefits",
    title: "Nevada PERS post-retirement employment",
    summary: "A public source discusses reemployment, return-to-work, or the waiting period after Nevada PERS retirement.",
    intentScore: 58,
    patterns: [/(?:Nevada PERS|NVPERS).{0,50}(?:reemployment|return to work|90-day waiting period|benefit suspension)/i, /rehired retiree.{0,50}(?:Nevada|school district)/i],
  },
  {
    signalType: "pers_legislative_change",
    category: "legislation",
    title: "Nevada PERS legislative or contribution change",
    summary: "An official or public source discusses a pension bill, contribution-rate change, COLA, multiplier, or reemployment rule.",
    intentScore: 48,
    patterns: [/(?:Nevada PERS|NVPERS).{0,55}(?:legislation|bill|contribution rate|rate increase|COLA|multiplier|reemployment rule)/i, /NRS 286.{0,60}(?:amend|revis|change)/i],
  },
  {
    signalType: "workforce_pressure",
    category: "workforce",
    title: "Nevada education workforce pressure",
    summary: "A Nevada school source reports budget or workforce pressure. This is contextual only and cannot identify an individual prospect by itself.",
    intentScore: 38,
    patterns: [/(?:Nevada|school district).{0,70}(?:budget deficit|budget shortfall|reduction in force|position elimination|school closure|staff reduction|early retirement incentive)/i],
  },
  {
    signalType: "irs_retirement_guidance",
    category: "official_guidance",
    title: "IRS retirement-plan guidance update",
    summary: "Official IRS guidance references 403(b), 401(k), 457(b), catch-up contributions, or retirement-plan limits relevant to educational content.",
    intentScore: 45,
    patterns: [/(?:403\s?\(b\)|401\s?\(k\)|457\s?\(b\)).{0,70}(?:contribution limit|catch-up|distribution|guidance|publication 571)/i],
  },
  {
    signalType: "retirement_update",
    category: "official_guidance",
    title: "General Nevada retirement update",
    summary: "An approved public source contains Nevada educator retirement content that requires classification and human review.",
    intentScore: 24,
    patterns: [/(?:Nevada PERS|NVPERS|Nevada educator retirement|Nevada teacher retirement)/i],
  },
] as const;

const NEVADA_CONTEXT = /\bNevada\b|\bNVPERS\b|\bNV\s*PERS\b|\bnvpers\.org\b|\b(?:Clark|Washoe|Lyon|Carson City|Douglas|Elko|Nye|Churchill|Humboldt|Mineral|Pershing|Storey|White Pine|Lander|Lincoln|Esmeralda|Eureka) County School District\b/i;
const EDUCATOR_CONTEXT = /\bteacher\b|\beducator\b|\bprincipal\b|\bsuperintendent\b|\bschool district\b|\bpublic school\b|\blicensed personnel\b|\bcertified personnel\b|\bfaculty\b/i;
const EXCLUSION_CONTEXT = /Texas TRS|Teacher Retirement System of Texas|TexasTeachers|Rule of 80|Rule of 85|CalSTRS|CalPERS|Arizona State Retirement System|Florida Retirement System|NYSTRS|DROP program|police retirement|firefighter retirement|private school retirement|military retirement|federal employee retirement|retired jersey|software retirement|retirement community|retirement home/i;

export function buildNevadaRetirementSearchCatalog(): RetirementSearchPlan[] {
  const districtSearches = NEVADA_SCHOOL_DISTRICTS.flatMap((district) =>
    DISTRICT_SEARCH_TEMPLATES.map((template) => ({
      id: `district-${slug(district.name)}-${template.id}`,
      category: template.category,
      query: `site:${district.domain} ${template.suffix}`,
      sourceType: "district" as const,
    })),
  );
  return [...STATIC_SEARCHES, ...districtSearches];
}

export function selectNevadaRetirementSearches(seed: string, limit = 8): RetirementSearchPlan[] {
  const safeLimit = Math.max(1, Math.min(25, Math.floor(limit)));
  return buildNevadaRetirementSearchCatalog()
    .map((search) => ({ search, order: stableHash(`${seed}:${search.id}`) }))
    .sort((a, b) => a.order - b.order)
    .slice(0, safeLimit)
    .map(({ search }) => search);
}

export function analyzeNevadaRetirementText(
  text: string,
  source: { url: string; sourceType?: string },
): RetirementSignalMatch[] {
  const normalized = text.replace(/\s+/g, " ").trim().slice(0, 100_000);
  if (!normalized) return [];
  const sourceIsOfficialContext = /(?:nvpers\.org|leg\.state\.nv\.us|doe\.nv\.gov|\.k12\.nv\.us|irs\.gov)/i.test(source.url);
  const hasNevadaContext = sourceIsOfficialContext || NEVADA_CONTEXT.test(normalized);
  if (!hasNevadaContext) return [];

  const hasEducatorContext = EDUCATOR_CONTEXT.test(normalized) || source.sourceType === "district" || source.sourceType === "school";
  const hasExclusion = EXCLUSION_CONTEXT.test(normalized);
  const reliability = sourceReliability(source.url, source.sourceType);
  const metadata = extractMetadata(normalized);

  return SIGNAL_DEFINITIONS.flatMap((definition) => {
    const match = definition.patterns.map((pattern) => normalized.match(pattern)).find(Boolean);
    if (!match?.[0]) return [];
    if (hasExclusion && definition.intentScore < 75) return [];
    if (!hasEducatorContext && !["legislation", "official_guidance", "benefits"].includes(definition.category)) return [];
    const finalPriorityScore = Math.min(100, Math.round(definition.intentScore * reliability));
    const confidence = Math.min(0.99, Number((0.48 + definition.intentScore / 220 + Math.max(0, reliability - 1) * 0.45).toFixed(2)));
    return [{
      signalType: definition.signalType,
      category: definition.category,
      title: definition.title,
      summary: definition.summary,
      signalPhrase: match[0].replace(/\s+/g, " ").trim().slice(0, 180),
      excerpt: excerptAround(normalized, match.index ?? 0, match[0].length),
      intentScore: definition.intentScore,
      sourceReliabilityScore: reliability,
      finalPriorityScore,
      confidence,
      metadata,
      verificationStatus: "pending_human_review",
      humanReviewRequired: true,
      outreachEligible: false,
      suppressionReason: "Public signal requires identity, Nevada public-employer, educator-role, and retirement-context verification before outreach.",
    } satisfies RetirementSignalMatch];
  });
}

export function getRetirementSignalDefinitionCount(): number {
  return SIGNAL_DEFINITIONS.length;
}

export const PARALLEL_RETIREMENT_DISCOVERY_OBJECTIVE = [
  "Find current, publicly accessible pages containing documented Nevada public-educator retirement signals.",
  "Use Nevada PERS / NVPERS terms only; exclude Texas TRS, Rule of 80, Rule of 85, TexasTeachers, and DROP-program results unless a Nevada source explicitly uses those terms.",
  "Prioritize official NVPERS, Nevada government, public school district, school-board, HR/benefits, IRS, reputable news, and public professional pages.",
  "Rank highest: an exact retirement date, a submitted or board-approved retirement application, NVPERS Ready to Retire participation, 30 to 33.3 years of service, a public retirement announcement, or a service-credit purchase.",
  "Rank medium: district retirement workshops, benefit estimates, retiree-health planning, Nevada PERS legislative changes, retirement incentives, layoffs, or restructuring.",
  "Rank low: generic retirement articles or budget news with no verified educator connection.",
  "For people, return only professional identity, public-employer context, and work contact details explicitly published by the employer for professional contact.",
  "Do not return private or login-gated pages, union member-only directories, personal phone numbers, home addresses, personal financial details, guessed emails, or anonymous-user identities.",
  "A result is research evidence only and must not be marked outreach-eligible without human verification.",
].join(" ");

export const PARALLEL_RETIREMENT_EXTRACTION_OBJECTIVE = [
  "Extract evidence of Nevada public-educator retirement timing, NVPERS eligibility or education events, service milestones, board actions, benefits transitions, 403(b)/457(b) planning, IRS guidance, or workforce pressure.",
  "Use Nevada PERS / NVPERS terms only; exclude Texas TRS, Rule of 80, Rule of 85, TexasTeachers, and DROP-program content unless a Nevada source explicitly uses those terms.",
  "Preserve source title, publication date, quoted evidence, employer, professional role, and any explicitly published professional work contact information.",
  "Do not extract home addresses, personal phone numbers, personal emails, private financial information, or data behind authentication.",
  "Never guess an email address, and never treat a district-wide signal as proof that a specific educator is retiring.",
].join(" ");

function extractMetadata(text: string): Record<string, string | number | null> {
  const years = text.match(/\b(20|2[5-9]|3[0-9]|40) years? (?:of )?(?:service|teaching|education)\b/i);
  const cohort = /before January 1[,]? 2010|pre-?2010/i.test(text)
    ? "pre_2010"
    : /between 2010 and 2015|2010.{0,15}2015/i.test(text)
      ? "2010_to_june_2015"
      : /after July 1[,]? 2015|post-?2015/i.test(text)
        ? "post_july_2015"
        : null;
  const date = text.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s+\d{4})?\b/i);
  return {
    years_of_service: years ? Number(years[1]) : null,
    pers_enrollment_cohort: cohort,
    possible_event_or_effective_date: date?.[0] ?? null,
  };
}

function sourceReliability(url: string, sourceType?: string): number {
  const hostname = safeHostname(url);
  if (hostname === "nvpers.org" || hostname.endsWith(".nvpers.org") || hostname === "leg.state.nv.us") return 1.3;
  if (hostname.endsWith(".nv.gov") || hostname === "irs.gov" || hostname.endsWith(".irs.gov")) return 1.25;
  if (NEVADA_SCHOOL_DISTRICTS.some((district) => hostname === district.domain || hostname.endsWith(`.${district.domain}`))) return 1.2;
  if (sourceType === "news") return 1.1;
  if (/reddit\.com|facebook\.com|linkedin\.com/i.test(hostname)) return 0.7;
  return 1;
}

function safeHostname(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 160);
  const end = Math.min(text.length, index + length + 300);
  return text.slice(start, end).trim().slice(0, 700);
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
