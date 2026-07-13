import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, Bot, Cable, CheckCircle2, ExternalLink, LoaderCircle, Play, PlugZap, Search, ServerCog, ShieldCheck, Unplug, WandSparkles } from "lucide-react";
import { getJson, isDemo, mutateJson } from "../lib/api";
import { PageHeader, StatusBadge } from "./ui";

type Risk = "low" | "medium" | "high" | "critical";

interface CatalogEntry {
  id: string;
  name: string;
  sourceUrl: string;
  category: string;
  description: string;
  tags: string[];
  riskLevel: Risk;
}

interface CatalogResponse {
  entries: CatalogEntry[];
  total: number;
  categories: string[];
  source: string;
  syncedAt: string;
}

interface McpStatus {
  servers: Array<{ id: string; name: string; url: string; state: string }>;
  tools: Array<{ name: string; title: string; description: string; serverId: string }>;
  resources: number;
  prompts: number;
  updatedAt: string;
}

interface McpPlan {
  id: string;
  task: string;
  state: "configuration_required" | "approval_required";
  riskLevel: Risk;
  recommendations: Array<CatalogEntry & { score: number; matchedTerms: string[] }>;
  connectedTools: Array<{ name: string; title: string; description: string; serverId: string; score: number }>;
  serverIds: string[];
  steps: string[];
  approvalRequired: boolean;
  expiresAt: string;
}

const emptyStatus: McpStatus = { servers: [], tools: [], resources: 0, prompts: 0, updatedAt: new Date(0).toISOString() };
const demoCatalog: CatalogResponse = {
  entries: [
    { id: "github", name: "GitHub MCP", sourceUrl: "https://github.com/github/github-mcp-server", category: "Repository & Code Analysis MCP Servers", description: "Repository search, issue, and pull request tools.", tags: ["github", "code"], riskLevel: "high" },
    { id: "google-workspace", name: "Google Workspace MCP", sourceUrl: "https://github.com/taylorwilsdon/google_workspace_mcp", category: "API Integration MCP Servers", description: "Gmail, Calendar, Drive, and Workspace tools.", tags: ["gmail", "calendar"], riskLevel: "critical" },
  ],
  total: 4065,
  categories: ["API Integration MCP Servers", "Repository & Code Analysis MCP Servers"],
  source: "https://github.com/ever-works/awesome-mcp-servers",
  syncedAt: new Date().toISOString(),
};

export function McpAgentPage() {
  const [catalog, setCatalog] = useState<CatalogResponse>(demoCatalog);
  const [status, setStatus] = useState<McpStatus>(emptyStatus);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [task, setTask] = useState("");
  const [plan, setPlan] = useState<McpPlan | null>(null);
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [connector, setConnector] = useState({ id: "", name: "", url: "", transport: "auto" as "auto" | "streamable-http" | "sse" });

  const load = async (search = query, selectedCategory = category) => {
    const params = new URLSearchParams({ limit: "48" });
    if (search.trim()) params.set("q", search.trim());
    if (selectedCategory) params.set("category", selectedCategory);
    const [catalogResponse, statusResponse] = await Promise.all([
      getJson(`/api/mcp/catalog?${params}`, demoCatalog),
      getJson("/api/mcp/status", emptyStatus),
    ]);
    setCatalog(catalogResponse);
    setStatus(statusResponse);
  };

  useEffect(() => { void load("", "").catch((loadError) => setError(message(loadError))); }, []);

  const connectedIds = useMemo(() => new Set(status.servers.map((server) => server.id)), [status.servers]);

  const searchCatalog = async (event: FormEvent) => {
    event.preventDefault(); setBusy("search"); setError("");
    try { await load(); } catch (searchError) { setError(message(searchError)); } finally { setBusy(null); }
  };

  const connect = async (event: FormEvent) => {
    event.preventDefault(); setBusy("connect"); setError("");
    try {
      const response = await mutateJson<ConnectResponse>("/api/mcp/connect", "POST", connector);
      if (response.connection?.state === "authenticating" && response.connection.authUrl) {
        window.location.assign(response.connection.authUrl);
        return;
      }
      setConnector({ id: "", name: "", url: "", transport: "auto" });
      await load();
    } catch (connectError) { setError(message(connectError)); } finally { setBusy(null); }
  };

  const disconnect = async (id: string) => {
    setBusy(`disconnect-${id}`); setError("");
    try { await mutateJson(`/api/mcp/connect/${encodeURIComponent(id)}`, "DELETE"); await load(); }
    catch (disconnectError) { setError(message(disconnectError)); }
    finally { setBusy(null); }
  };

  const createPlan = async (event: FormEvent) => {
    event.preventDefault(); setBusy("plan"); setError(""); setResult("");
    try { setPlan(await mutateJson<McpPlan>("/api/mcp/plans", "POST", { task })); }
    catch (planError) { setError(message(planError)); }
    finally { setBusy(null); }
  };

  const execute = async () => {
    if (!plan) return;
    setBusy("execute"); setError("");
    try {
      const response = await mutateJson<{ result?: { text?: string } }>(`/api/mcp/plans/${plan.id}/execute`, "POST", { approved: true });
      setResult(response.result?.text ?? "The approved run completed without a text response.");
    } catch (executeError) { setError(message(executeError)); }
    finally { setBusy(null); }
  };

  const chooseEntry = (entry: CatalogEntry) => {
    setConnector({ id: entry.id, name: entry.name, url: "", transport: "auto" });
    document.getElementById("connector-form")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return <>
    <PageHeader eyebrow="Universal tool routing" title="MCP Control Agent" description="Search the complete MCP catalog, connect approved remote servers, plan tasks, and execute only after a recorded human approval." actions={<a className="button secondary" href={catalog.source} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Source catalog</a>} />
    {error && <div className="mcp-alert"><AlertTriangle size={17} /><span>{error}</span></div>}

    <section className="mcp-metrics">
      <article><ServerCog size={19} /><div><strong>{catalog.total.toLocaleString()}</strong><span>catalog matches</span></div></article>
      <article><Cable size={19} /><div><strong>{status.servers.length}</strong><span>connected servers</span></div></article>
      <article><PlugZap size={19} /><div><strong>{status.tools.length}</strong><span>available tools</span></div></article>
      <article><ShieldCheck size={19} /><div><strong>Required</strong><span>execution approval</span></div></article>
    </section>

    <section className="mcp-workspace-grid">
      <article className="panel mcp-task-panel">
        <div className="panel-header"><div><span className="section-kicker">Plan first</span><h2>Route a task</h2></div><Bot size={20} /></div>
        <form onSubmit={createPlan} className="mcp-task-form">
          <label htmlFor="mcp-task">What should the agent accomplish?</label>
          <textarea id="mcp-task" value={task} onChange={(event) => setTask(event.target.value)} rows={4} minLength={5} maxLength={2000} placeholder="Example: Find the latest Nevada educator retirement policy update and summarize the verified sources." required />
          <button className="button primary" disabled={busy !== null}><WandSparkles size={16} /> {busy === "plan" ? "Planning…" : "Create safe plan"}</button>
        </form>
        {plan && <div className={`mcp-plan risk-${plan.riskLevel}`}>
          <div className="mcp-plan-head"><div><span>Plan {plan.id.slice(0, 8)}</span><strong>{plan.state === "approval_required" ? "Ready for approval" : "Connector setup required"}</strong></div><span className={`risk-pill ${plan.riskLevel}`}>{plan.riskLevel} risk</span></div>
          <ol>{plan.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          {plan.connectedTools.length > 0 && <div className="mcp-tool-chips">{plan.connectedTools.slice(0, 8).map((tool) => <span key={`${tool.serverId}-${tool.name}`}>{tool.serverId} / {tool.title}</span>)}</div>}
          {plan.approvalRequired && <button className="button primary danger-aware" onClick={execute} disabled={busy !== null}><Play size={15} /> {busy === "execute" ? "Executing approved task…" : "Approve exact task & run"}</button>}
        </div>}
        {result && <div className="mcp-result"><CheckCircle2 size={18} /><div><strong>Confirmed result</strong><p>{result}</p></div></div>}
      </article>

      <article className="panel mcp-connect-panel" id="connector-form">
        <div className="panel-header"><div><span className="section-kicker">Explicit endpoints only</span><h2>Connect a server</h2></div><Cable size={20} /></div>
        <p className="mcp-help">Catalog links are source projects. Deploy the chosen server or obtain its remote endpoint, then enter the HTTPS <strong>Streamable HTTP</strong> or <strong>SSE</strong> URL here.</p>
        <form onSubmit={connect} className="form-stack">
          <label>Stable ID<input value={connector.id} onChange={(event) => setConnector((value) => ({ ...value, id: slug(event.target.value) }))} placeholder="github" pattern="[a-z0-9][a-z0-9-]*" required /></label>
          <label>Display name<input value={connector.name} onChange={(event) => setConnector((value) => ({ ...value, name: event.target.value }))} placeholder="GitHub MCP" required /></label>
          <label>Remote MCP endpoint<input type="url" value={connector.url} onChange={(event) => setConnector((value) => ({ ...value, url: event.target.value }))} placeholder="https://mcp.example.com/mcp" required /></label>
          <label>Transport<select value={connector.transport} onChange={(event) => setConnector((value) => ({ ...value, transport: event.target.value as typeof value.transport }))}><option value="auto">Auto detect</option><option value="streamable-http">Streamable HTTP</option><option value="sse">SSE (legacy)</option></select></label>
          <button className="button primary" disabled={busy !== null}><PlugZap size={15} /> {busy === "connect" ? "Connecting…" : "Connect server"}</button>
        </form>
        <div className="mcp-server-list">
          {status.servers.length === 0 && <p>No remote MCP servers connected yet.</p>}
          {status.servers.map((server) => <div key={server.id}><span className={`server-dot ${server.state}`} /><div><strong>{server.name}</strong><span>{server.url}</span></div><StatusBadge value={server.state} /><button className="icon-button" onClick={() => void disconnect(server.id)} disabled={busy !== null} title="Disconnect"><Unplug size={15} /></button></div>)}
        </div>
      </article>
    </section>

    <section className="panel mcp-catalog-panel">
      <div className="panel-header"><div><span className="section-kicker">{catalog.total.toLocaleString()} results</span><h2>Awesome MCP catalog</h2></div><span className="catalog-sync">Synced {new Date(catalog.syncedAt).toLocaleDateString()}</span></div>
      <form className="mcp-catalog-toolbar" onSubmit={searchCatalog}>
        <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search GitHub, Slack, databases, browser, finance…" /></label>
        <select value={category} onChange={(event) => { setCategory(event.target.value); void load(query, event.target.value); }}><option value="">All categories</option>{catalog.categories.map((item) => <option key={item}>{item}</option>)}</select>
        <button className="button secondary" disabled={busy !== null}>{busy === "search" ? <LoaderCircle className="spin" size={15} /> : <Search size={15} />} Search</button>
      </form>
      <div className="mcp-catalog-grid">
        {catalog.entries.map((entry) => <article key={entry.id}>
          <div><span className={`risk-dot ${entry.riskLevel}`} /><span>{entry.category}</span><span className={`risk-pill ${entry.riskLevel}`}>{entry.riskLevel}</span></div>
          <h3>{entry.name}</h3><p>{entry.description}</p>
          <div className="mcp-tags">{entry.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}</div>
          <footer><a href={entry.sourceUrl} target="_blank" rel="noreferrer">Inspect source <ExternalLink size={12} /></a><button className="text-button" onClick={() => chooseEntry(entry)} disabled={connectedIds.has(entry.id)}>{connectedIds.has(entry.id) ? "Connected" : "Configure"}</button></footer>
        </article>)}
      </div>
    </section>
    {isDemo && <p className="mcp-demo-note">Demo mode shows the control surface without opening external connections or executing tools.</p>}
  </>;
}

interface ConnectResponse { connection?: { state: string; authUrl?: string } }
function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80); }
function message(error: unknown): string { return error instanceof Error ? error.message : "The MCP operation could not be completed."; }
