import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Check, Clock3, X } from "lucide-react";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</div>;
}

export function MetricCard({ label, value, detail, icon, tone = "blue", trend }: { label: string; value: string | number; detail: string; icon: ReactNode; tone?: string; trend?: number }) {
  return <article className="metric-card"><div className={`metric-icon ${tone}`}>{icon}</div><div className="metric-copy"><span>{label}</span><strong>{value}</strong><small>{trend !== undefined && <span className={trend >= 0 ? "trend-up" : "trend-down"}>{trend >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(trend)}%</span>} {detail}</small></div></article>;
}

export function StatusBadge({ value }: { value: string }) {
  const normalized = value.replaceAll("_", " ");
  return <span className={`status-badge status-${value}`}><span />{normalized}</span>;
}

export function ScoreRing({ score }: { score: number }) {
  const tone = score >= 75 ? "hot" : score >= 50 ? "warm" : "cool";
  return <div className={`score-ring ${tone}`} style={{ "--score": `${score * 3.6}deg` } as React.CSSProperties}><span>{score}</span></div>;
}

export function EmptyState({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }) {
  return <div className="empty-state"><div>{icon}</div><strong>{title}</strong><p>{copy}</p></div>;
}

export function Modal({ title, description, children, onClose, footer }: { title: string; description?: string; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}><button className="modal-backdrop" onClick={onClose} aria-label="Close" /><section className="modal-card"><div className="modal-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div><button className="icon-button" onClick={onClose}><X size={20} /></button></div><div className="modal-body">{children}</div>{footer && <div className="modal-footer">{footer}</div>}</section></div>;
}

export function Toast({ message, tone = "success", onClose }: { message: string; tone?: "success" | "error" | "info"; onClose: () => void }) {
  return <div className={`toast toast-${tone}`}><div>{tone === "success" ? <Check size={17} /> : tone === "error" ? <X size={17} /> : <Clock3 size={17} />}</div><span>{message}</span><button onClick={onClose}><X size={15} /></button></div>;
}

export function timeAgo(value: string | null): string {
  if (!value) return "Never";
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1_000);
  if (seconds < 60) return "just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d ago`;
  return new Date(value).toLocaleDateString();
}
