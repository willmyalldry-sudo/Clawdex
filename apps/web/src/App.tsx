import { useCallback, useEffect, useState } from "react";
import { Layout } from "./components/Layout";
import { Toast } from "./components/ui";
import { AnalyticsPage, ApprovalsPage, CampaignsPage, DashboardPage, LeadsPage, SettingsPage, SignalsPage, SourcesPage } from "./components/pages";
import { McpAgentPage } from "./components/McpAgentPage";
import { getJson, isDemo, mutateJson } from "./lib/api";
import { demoActivity, demoApprovals, demoCampaigns, demoDashboard, demoLeads, demoSignals, demoSources } from "./lib/demo-data";
import type { Activity, Approval, Campaign, DashboardData, Lead, PageId, Signal, Source } from "./lib/types";

const validPages: PageId[] = ["dashboard", "leads", "signals", "campaigns", "approvals", "analytics", "sources", "mcp", "settings"];

export function App() {
  const [page, setPage] = useState<PageId>(() => pageFromHash());
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" | "info" } | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData>(demoDashboard);
  const [leads, setLeads] = useState<Lead[]>(demoLeads);
  const [signals, setSignals] = useState<Signal[]>(demoSignals);
  const [campaigns, setCampaigns] = useState<Campaign[]>(demoCampaigns);
  const [approvals, setApprovals] = useState<Approval[]>(demoApprovals);
  const [activity, setActivity] = useState<Activity[]>(demoActivity);
  const [sources, setSources] = useState<Source[]>(demoSources);
  const [providerStatus, setProviderStatus] = useState({ tinyfish: isDemo, parallel: isDemo, apollo: isDemo, peopleDataLabs: false, zerobounce: isDemo, agentmail: isDemo, autosend: false });

  const navigate = useCallback((nextPage: PageId) => {
    setPage(nextPage);
    window.location.hash = nextPage;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [dashboardResponse, leadsResponse, signalsResponse, campaignsResponse, approvalsResponse, activityResponse, sourcesResponse, healthResponse] = await Promise.all([
          getJson("/api/dashboard", demoDashboard),
          getJson("/api/leads", { leads: demoLeads }),
          getJson("/api/signals", { signals: demoSignals }),
          getJson("/api/campaigns", { campaigns: demoCampaigns }),
          getJson("/api/approvals", { approvals: demoApprovals }),
          getJson("/api/activity", { activity: demoActivity }),
          getJson("/api/sources", { sources: demoSources }),
          getJson("/api/health", {
            researchProviders: { tinyfish: isDemo, parallel: isDemo },
            enrichmentProviders: { apollo: isDemo, peopleDataLabs: false },
            validationProviders: { zerobounce: isDemo },
            emailProviders: { agentmail: isDemo, autosend: false },
          }),
        ]);
        if (!cancelled) {
          setDashboard(dashboardResponse); setLeads(leadsResponse.leads as Lead[]); setSignals(signalsResponse.signals as Signal[]);
          setCampaigns(campaignsResponse.campaigns as Campaign[]); setApprovals(approvalsResponse.approvals as Approval[]);
          setActivity(activityResponse.activity as Activity[]); setSources(sourcesResponse.sources as Source[]);
          setProviderStatus({
            tinyfish: Boolean(healthResponse.researchProviders?.tinyfish),
            parallel: Boolean(healthResponse.researchProviders?.parallel),
            apollo: Boolean(healthResponse.enrichmentProviders?.apollo),
            peopleDataLabs: Boolean(healthResponse.enrichmentProviders?.peopleDataLabs),
            zerobounce: Boolean(healthResponse.validationProviders?.zerobounce),
            agentmail: Boolean(healthResponse.emailProviders?.agentmail),
            autosend: Boolean(healthResponse.emailProviders?.autosend),
          });
        }
      } catch (error) {
        if (!cancelled) setToast({ message: error instanceof Error ? error.message : "Could not load workspace data.", tone: "error" });
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [refreshKey]);

  const performAction = useCallback(async (path: string, body?: unknown) => {
    try {
      await mutateJson(path, "POST", body);
      setToast({ message: isDemo ? "Demo action simulated—no external system was changed." : "Action accepted. Agent activity will update shortly.", tone: isDemo ? "info" : "success" });
      setRefreshKey((key) => key + 1);
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : "Action failed.", tone: "error" });
      throw error;
    }
  }, []);

  const handleSearch = (value: string) => { if (value.trim().length >= 2 && page !== "leads") navigate("leads"); };

  return <Layout page={page} onNavigate={navigate} mobileOpen={mobileOpen} onMobileOpen={setMobileOpen} onSearch={handleSearch}>
    {loading && <div className="loading-line" />}
    {page === "dashboard" && <DashboardPage dashboard={dashboard} leads={leads} activity={activity} onNavigate={navigate} onAction={performAction} />}
    {page === "leads" && <LeadsPage leads={leads} onAction={performAction} />}
    {page === "signals" && <SignalsPage signals={signals} />}
    {page === "campaigns" && <CampaignsPage campaigns={campaigns} leads={leads} onAction={performAction} />}
    {page === "approvals" && <ApprovalsPage approvals={approvals} onAction={performAction} />}
    {page === "analytics" && <AnalyticsPage dashboard={dashboard} campaigns={campaigns} />}
    {page === "sources" && <SourcesPage sources={sources} activity={activity} onAction={performAction} />}
    {page === "mcp" && <McpAgentPage />}
    {page === "settings" && <SettingsPage providerStatus={providerStatus} />}
    {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
  </Layout>;
}

function pageFromHash(): PageId {
  const hash = window.location.hash.replace("#", "") as PageId;
  return validPages.includes(hash) ? hash : "dashboard";
}
