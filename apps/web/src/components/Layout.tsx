import type { ReactNode } from "react";
import {
  Activity, BarChart3, Bell, Bot, Cable, CheckSquare2, DatabaseZap, LayoutDashboard, Megaphone,
  Menu, Radar, Search, Settings2, ShieldCheck, Sparkles, Users, X,
} from "lucide-react";
import type { PageId } from "../lib/types";
import { isDemo } from "../lib/api";

export const navItems: Array<{ id: PageId; label: string; icon: typeof Activity; group: string }> = [
  { id: "dashboard", label: "Command center", icon: LayoutDashboard, group: "Operate" },
  { id: "leads", label: "Lead intelligence", icon: Users, group: "Operate" },
  { id: "signals", label: "Signal feed", icon: Radar, group: "Operate" },
  { id: "campaigns", label: "Campaigns", icon: Megaphone, group: "Engage" },
  { id: "approvals", label: "Safety blocks", icon: CheckSquare2, group: "Engage" },
  { id: "analytics", label: "Analytics", icon: BarChart3, group: "Measure" },
  { id: "sources", label: "Sources & agents", icon: DatabaseZap, group: "System" },
  { id: "mcp", label: "MCP control agent", icon: Cable, group: "System" },
  { id: "settings", label: "Compliance", icon: ShieldCheck, group: "System" },
];

interface LayoutProps {
  page: PageId;
  onNavigate: (page: PageId) => void;
  mobileOpen: boolean;
  onMobileOpen: (open: boolean) => void;
  children: ReactNode;
  onSearch: (value: string) => void;
}

export function Layout({ page, onNavigate, mobileOpen, onMobileOpen, children, onSearch }: LayoutProps) {
  const groups = [...new Set(navItems.map((item) => item.group))];
  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
      <div className="brand-row">
        <div className="brand-mark"><Sparkles size={18} /></div>
        <div><strong>Persyn OS</strong><span>Retirement intelligence</span></div>
        <button className="icon-button sidebar-close" onClick={() => onMobileOpen(false)} aria-label="Close navigation"><X size={19} /></button>
      </div>
      <div className="advisor-card">
        <div className="avatar">BP</div>
        <div><strong>Benjamin Persyn</strong><span>Nevada educator advisor</span></div>
        <span className="online-dot" title="System online" />
      </div>
      <nav className="primary-nav" aria-label="Primary navigation">
        {groups.map((group) => <div className="nav-group" key={group}>
          <span className="nav-label">{group}</span>
          {navItems.filter((item) => item.group === group).map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={`nav-item ${page === item.id ? "active" : ""}`} onClick={() => { onNavigate(item.id); onMobileOpen(false); }}>
              <Icon size={18} strokeWidth={1.8} /><span>{item.label}</span>
            </button>;
          })}
        </div>)}
      </nav>
      <div className="sidebar-footer">
        <div className="system-status"><Bot size={16} /><div><strong>Hourly pipeline ready</strong><span>Fail-closed guard active</span></div><span className="pulse" /></div>
        <button className="nav-item" onClick={() => onNavigate("settings")}><Settings2 size={18} /><span>Workspace settings</span></button>
      </div>
    </aside>
    {mobileOpen && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => onMobileOpen(false)} />}
    <div className="workspace">
      {isDemo && <div className="demo-banner"><ShieldCheck size={15} /> Demo workspace — outbound sending is disabled and all contacts are fictional.</div>}
      <header className="topbar">
        <button className="icon-button menu-button" onClick={() => onMobileOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
        <label className="global-search"><Search size={17} /><input placeholder="Search leads, signals, campaigns…" onChange={(event) => onSearch(event.target.value)} /><kbd>⌘ K</kbd></label>
        <div className="topbar-actions">
          <div className="live-pill"><span /> Live</div>
          <button className="icon-button notification-button" aria-label="Notifications"><Bell size={19} /><span /></button>
          <div className="user-avatar">BP</div>
        </div>
      </header>
      <main className="main-content">{children}</main>
    </div>
  </div>;
}
