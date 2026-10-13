"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Approval, AuditEntry, Policy } from "@/lib/types";

type PublicAgent = {
  id: string; name: string; status: "active" | "revoked"; policy: Policy; spent: number; createdAt: string;
};
type Chain = { ok: boolean; length: number; brokenAtSeq: number | null; problem: string | null };
type View = "overview" | "agents" | "approvals" | "audit";
type Toast = { id: number; msg: string; kind?: "ok" | "bad" };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json" }, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const ago = (iso: string) => {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 5) return "just now"; if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const hue = (str: string) => { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

const P = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);
const I = {
  shield: P("M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6l8-3zM9 12l2 2 4-4"),
  grid: P("M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"),
  bot: P("M6 8h12a2 2 0 012 2v8a2 2 0 01-2 2H6a2 2 0 01-2-2v-8a2 2 0 012-2zM12 4v4M9 14h.01M15 14h.01"),
  clock: P("M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2"),
  log: P("M5 4h14v16H5zM9 9h6M9 13h6M9 17h3"),
  ban: P("M12 3a9 9 0 100 18 9 9 0 000-18zM5.6 5.6l12.8 12.8"),
  coin: P("M12 3a9 9 0 100 18 9 9 0 000-18zM14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5V8m0 8v1.5"),
  check: P("M5 12l5 5 9-10"),
  plus: P("M12 5v14M5 12h14"),
  play: P("M8 5v14l11-7z"),
  search: P("M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5"),
  inbox: P("M3 13l3-8h12l3 8v6H3v-6zM3 13h5l1 3h6l1-3h5"),
  list: P("M4 6h16M4 12h16M4 18h16"),
  tiles: P("M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"),
  bolt: P("M13 3L5 14h6l-1 7 8-11h-6l1-7z"),
};

/* ---------- small charts (pure SVG) ---------- */
function ActivityChart({ checks }: { checks: AuditEntry[] }) {
  const ordered = [...checks].reverse().slice(-72);
  const N = 24;
  const size = Math.max(1, Math.ceil(ordered.length / N));
  const buckets: { allow: number; pending: number; deny: number }[] = [];
  for (let i = 0; i < ordered.length; i += size) {
    const b = { allow: 0, pending: 0, deny: 0 };
    ordered.slice(i, i + size).forEach((e) => { if (e.decision) b[e.decision]++; });
    buckets.push(b);
  }
  const max = Math.max(1, ...buckets.map((b) => b.allow + b.pending + b.deny));
  const W = 640, H = 190, pad = 8, bw = (W - pad * 2) / Math.max(buckets.length, 1);
  if (!buckets.length) return <div className="empty"><b>No activity yet</b>Decisions will chart here.</div>;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Decisions over time">
      {[0.25, 0.5, 0.75, 1].map((g) => <line key={g} x1={0} x2={W} y1={H - 18 - (H - 36) * g} y2={H - 18 - (H - 36) * g} className="gl" />)}
      {buckets.map((b, i) => {
        let y = H - 18; const x = pad + i * bw + 2; const w = Math.max(2, bw - 4);
        const seg = (n: number, cls: string) => { if (!n) return null; const h = ((H - 36) * n) / max; y -= h; return <rect key={cls} x={x} y={y} width={w} height={h} rx={2} className={cls} />; };
        return <g key={i}>{seg(b.allow, "b-allow")}{seg(b.pending, "b-pending")}{seg(b.deny, "b-deny")}</g>;
      })}
    </svg>
  );
}

function Donut({ parts }: { parts: { label: string; n: number; cls: string }[] }) {
  const total = parts.reduce((s, p) => s + p.n, 0);
  const R = 54, C = 2 * Math.PI * R; let off = 0;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 140 140" className="donut" role="img" aria-label="Decision breakdown">
        <circle cx="70" cy="70" r={R} className="d-track" />
        {total > 0 && parts.map((p) => { const len = (p.n / total) * C; const el = <circle key={p.label} cx="70" cy="70" r={R} className={`d-seg ${p.cls}`} strokeDasharray={`${Math.max(len - 2, 0)} ${C}`} strokeDashoffset={-off} transform="rotate(-90 70 70)" />; off += len; return el; })}
        <text x="70" y="68" textAnchor="middle" className="d-num">{total}</text>
        <text x="70" y="86" textAnchor="middle" className="d-lbl">checks</text>
      </svg>
      <ul className="legend">{parts.map((p) => <li key={p.label}><i className={p.cls} />{p.label}<b>{p.n}</b><span>{total ? Math.round((p.n / total) * 100) : 0}%</span></li>)}</ul>
    </div>
  );
}

function Bars({ rows, cls = "" }: { rows: { label: string; n: number; sub?: string }[]; cls?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <div className="empty sm">Nothing to show yet.</div>;
  return <ul className="bars">{rows.map((r) => <li key={r.label}><div className="bl"><span className="chip tool">{r.label}</span><b>{r.n}{r.sub ?? ""}</b></div><div className="bt"><i className={cls} style={{ width: `${(r.n / max) * 100}%` }} /></div></li>)}</ul>;
}

/* ---------- main ---------- */
export default function Dashboard() {
  const [agents, setAgents] = useState<PublicAgent[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [chain, setChain] = useState<Chain | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null);
  const [editing, setEditing] = useState<PublicAgent | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("overview");
  const [filter, setFilter] = useState<"all" | "allow" | "deny" | "pending">("all");
  const [q, setQ] = useState("");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [showN, setShowN] = useState(12);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [, tick] = useState(0);
  const tid = useRef(0);

  const toast = useCallback((msg: string, kind?: "ok" | "bad") => {
    const id = ++tid.current;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [a, p, l] = await Promise.all([
        api<{ agents: PublicAgent[] }>("/api/agents"),
        api<{ approvals: Approval[] }>("/api/approvals?status=pending"),
        api<{ entries: AuditEntry[]; chain: Chain }>("/api/audit?limit=100"),
      ]);
      setAgents(a.agents); setApprovals(p.approvals); setAudit(l.entries); setChain(l.chain); setError(null); setLoaded(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(() => { refresh(); tick((n) => n + 1); }, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); await refresh(); if (ok) toast(ok, "ok"); } catch (e) {
      const m = e instanceof Error ? e.message : "Action failed"; setError(m); toast(m, "bad");
    }
  };
  const resolve = (id: string, approve: boolean) =>
    act(() => api(`/api/approvals/${id}`, { method: "POST", body: JSON.stringify({ approve }) }), approve ? "Approved" : "Denied");

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id.slice(0, 8);
  const checks = useMemo(() => audit.filter((e) => e.event === "check"), [audit]);
  const cnt = (d: string) => checks.filter((e) => e.decision === d).length;
  const blocked = cnt("deny");
  const totalSpend = agents.reduce((s, a) => s + a.spent, 0);
  const totalBudget = agents.reduce((s, a) => s + a.policy.budget, 0);
  const activeCount = agents.filter((a) => a.status === "active").length;
  const topTools = useMemo(() => {
    const m = new Map<string, number>();
    checks.filter((e) => e.decision === "deny" && e.tool).forEach((e) => m.set(e.tool!, (m.get(e.tool!) ?? 0) + 1));
    return [...m].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, n]) => ({ label, n }));
  }, [checks]);
  const topSpend = useMemo(() => [...agents].sort((a, b) => b.spent - a.spent).slice(0, 5).map((a) => ({ label: `${a.name} · ${a.id.slice(0, 4)}`, n: a.spent })), [agents]);

  const filteredAgents = agents.filter((a) => !q.trim() || `${a.name} ${a.id}`.toLowerCase().includes(q.trim().toLowerCase()));
  const visibleLog = audit.filter((e) => filter === "all" || e.decision === filter);
  const countOf = (f: string) => (f === "all" ? audit.length : audit.filter((e) => e.decision === f).length);

  const nav: { id: View; label: string; icon: JSX.Element; badge?: number; warn?: boolean }[] = [
    { id: "overview", label: "Overview", icon: I.grid },
    { id: "agents", label: "Agents", icon: I.bot, badge: agents.length },
    { id: "approvals", label: "Approvals", icon: I.clock, badge: approvals.length, warn: approvals.length > 0 },
    { id: "audit", label: "Audit log", icon: I.log },
  ];
  const titles: Record<View, [string, string]> = {
    overview: ["Overview", "Everything your agents are doing, at a glance."],
    agents: ["Agents", "Policies, budgets and kill switches."],
    approvals: ["Approvals", "Actions waiting for a human decision."],
    audit: ["Audit log", "Tamper-evident record of every decision."],
  };

  const AgentCard = ({ a }: { a: PublicAgent }) => {
    const raw = a.policy.budget > 0 ? (a.spent / a.policy.budget) * 100 : 100;
    const pct = Math.min(100, raw); const h = hue(a.name);
    return (
      <div className={`card agent ${a.status}`}>
        <div className="agent-head">
          <div className="agent-id">
            <div className="avatar" style={{ background: `linear-gradient(135deg, hsl(${h} 75% 58%), hsl(${(h + 50) % 360} 70% 46%))` }}>{a.name.slice(0, 1).toUpperCase()}</div>
            <div style={{ minWidth: 0 }}><strong>{a.name}</strong><div className="mono muted">{a.id.slice(0, 8)} · {ago(a.createdAt)}</div></div>
          </div>
          <span className={`pill ${a.status}`}>{a.status}</span>
        </div>
        <div>
          <div className="meter-wrap"><span><b>{a.spent}</b> / {a.policy.budget}</span><span>{pct.toFixed(0)}% used</span></div>
          <div className="meter" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Budget used"><i className={pct >= 90 ? "hot" : pct >= 70 ? "mid" : ""} style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="limits">
          <div><b>{a.policy.maxCostPerAction}</b><span>max / action</span></div>
          <div><b>{a.policy.rateLimitPerMin}</b><span>calls / min</span></div>
          <div><b>{a.policy.approvalAboveCost ?? "—"}</b><span>approve &gt;</span></div>
        </div>
        <div className="chips">
          {a.policy.blockedTools.map((t) => <span className="chip bad" key={`b${t}`}>✕ {t}</span>)}
          {a.policy.approvalTools.map((t) => <span className="chip warn" key={`a${t}`}>⏸ {t}</span>)}
          {a.policy.allowedTools.map((t) => <span className="chip" key={`w${t}`}>{t}</span>)}
        </div>
        <div className="agent-actions">
          {a.status === "active"
            ? <button className="danger sm" onClick={() => { if (window.confirm(`Revoke “${a.name}”? All of its calls will be denied immediately.`)) act(() => api(`/api/agents/${a.id}`, { method: "PATCH", body: JSON.stringify({ status: "revoked" }) }), `${a.name} revoked`); }}>Kill switch</button>
            : <button className="ok sm" onClick={() => act(() => api(`/api/agents/${a.id}`, { method: "PATCH", body: JSON.stringify({ status: "active" }) }), `${a.name} reinstated`)}>Reinstate</button>}
          <button className="sm" onClick={() => setEditing(a)}>Edit policy</button>
          <button className="sm ghost" onClick={() => act(() => api(`/api/agents/${a.id}`, { method: "PATCH", body: JSON.stringify({ resetSpent: true }) }), "Spend reset")}>Reset spend</button>
        </div>
      </div>
    );
  };

  const ApprovalList = ({ items }: { items: Approval[] }) => (
    <div className="nopad">
      {items.length === 0 && <div className="empty">{I.inbox}<b>All clear</b>Actions that need a human will appear here.</div>}
      {items.map((ap) => (
        <div className="approval" key={ap.id}>
          <div style={{ minWidth: 0 }}>
            <strong>{agentName(ap.agentId)}</strong> <span className="muted">wants to call</span> <span className="chip tool">{ap.tool}</span> <span className="muted">· cost</span> <strong>{ap.cost}</strong>
            <div className="muted mono" title={new Date(ap.createdAt).toLocaleString()}>{ago(ap.createdAt)} · {timeOf(ap.createdAt)}</div>
            <pre>{JSON.stringify(ap.args)}</pre>
          </div>
          <div className="row">
            <button className="ok" onClick={() => resolve(ap.id, true)}>Approve</button>
            <button className="danger" onClick={() => resolve(ap.id, false)}>Deny</button>
          </div>
        </div>
      ))}
    </div>
  );

  const LogTable = ({ rows }: { rows: AuditEntry[] }) => (
    <div className="tablewrap">
      <table>
        <thead><tr><th>#</th><th>Time</th><th>Agent</th><th>Event</th><th>Tool</th><th>Cost</th><th>Decision</th><th>Why</th><th>Hash</th></tr></thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.seq} className={e.decision ? `r-${e.decision}` : ""}>
              <td className="mono muted">{e.seq}</td>
              <td className="mono" title={new Date(e.ts).toLocaleString()}>{timeOf(e.ts)}</td>
              <td>{agentName(e.agentId)}</td>
              <td>{e.event.replace("_", " ")}</td>
              <td>{e.tool ? <span className="chip tool">{e.tool}</span> : <span className="muted">—</span>}</td>
              <td>{e.cost || <span className="muted">—</span>}</td>
              <td>{e.decision ? <span className={`pill ${e.decision}`}>{e.decision}</span> : <span className="pill info">info</span>}</td>
              <td className="why">{e.detail}</td>
              <td className="mono muted" title={e.hash}>{e.hash.slice(0, 8)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={9}><div className="empty">{I.inbox}<b>No events</b>Nothing here yet.</div></td></tr>}
        </tbody>
      </table>
    </div>
  );

  const runDemo = () => act(async () => {
    const r = await api<{ agent: PublicAgent; apiKey: string }>("/api/demo", { method: "POST" });
    setNewKey({ name: r.agent.name, key: r.apiKey });
  }, "Demo agent created");

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <div className="logo">{I.shield}</div>
          <div><h1>AgentGuard</h1><p className="sub">Control tower</p></div>
        </div>
        <nav>
          {nav.map((n) => (
            <button key={n.id} className={`nav ${view === n.id ? "on" : ""}`} onClick={() => setView(n.id)} aria-current={view === n.id ? "page" : undefined}>
              {n.icon}<span>{n.label}</span>
              {n.badge !== undefined && n.badge > 0 && <em className={n.warn ? "warn" : ""}>{n.badge}</em>}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className={`health ${chain && !chain.ok ? "bad" : ""}`}>
            <div className="h-top">{I.check}<b>{chain ? (chain.ok ? "Chain verified" : "Chain broken") : "Checking…"}</b></div>
            <span>{chain ? (chain.ok ? `${chain.length} entries · every hash matches` : `Broken at #${chain.brokenAtSeq}: ${chain.problem}`) : "Verifying audit log"}</span>
          </div>
          <span className={`live ${error ? "off" : ""}`}><i />{error ? "Offline" : "Live · 2s refresh"}</span>
        </div>
      </aside>

      <main className="main">
        <header className="page-head">
          <div><h2 className="page-title">{titles[view][0]}</h2><p className="sub">{titles[view][1]}</p></div>
          <div className="row">
            <button onClick={runDemo}>{I.play}Run demo</button>
            <button className="primary" onClick={() => setEditing("new")}>{I.plus}New agent</button>
          </div>
        </header>

        {error && <div className="card err" role="alert">{error}</div>}
        {newKey && (
          <div className="banner" role="status">
            <strong>API key for “{newKey.name}”</strong> <span className="muted">— copy it now, it won’t be shown again.</span>
            <code>{newKey.key}</code>
            <div className="row">
              <button className="primary" onClick={async () => { try { await navigator.clipboard.writeText(newKey.key); toast("API key copied", "ok"); } catch { toast("Couldn’t copy — select it manually", "bad"); } }}>Copy key</button>
              <button onClick={() => setNewKey(null)}>Dismiss</button>
            </div>
          </div>
        )}

        {view === "overview" && (<>
          <div className="stats">
            <div className="card stat ok"><div className="ico">{I.bot}</div><div><span>Active agents</span><b>{activeCount}</b><small>{agents.length - activeCount} revoked</small></div></div>
            <button className={`card stat ${approvals.length ? "warn" : ""}`} onClick={() => setView("approvals")}><div className="ico">{I.clock}</div><div><span>Awaiting approval</span><b>{approvals.length}</b><small>{approvals.length ? "Needs your decision →" : "Nothing waiting"}</small></div></button>
            <div className={`card stat ${blocked ? "bad" : ""}`}><div className="ico">{I.ban}</div><div><span>Blocked actions</span><b>{blocked}</b><small>{checks.length ? Math.round((blocked / checks.length) * 100) : 0}% of last {checks.length} checks</small></div></div>
            <div className="card stat"><div className="ico">{I.coin}</div><div><span>Spend authorised</span><b>{totalSpend.toLocaleString()}</b><small>of {totalBudget.toLocaleString()} total budget</small></div></div>
          </div>

          <div className="cols c-2-1">
            <div className="card">
              <div className="card-head"><h3>Decisions over time</h3><div className="key"><i className="b-allow" />Allowed<i className="b-pending" />Pending<i className="b-deny" />Denied</div></div>
              <ActivityChart checks={checks} />
            </div>
            <div className="card">
              <div className="card-head"><h3>Outcome mix</h3></div>
              <Donut parts={[{ label: "Allowed", n: cnt("allow"), cls: "b-allow" }, { label: "Pending", n: cnt("pending"), cls: "b-pending" }, { label: "Denied", n: cnt("deny"), cls: "b-deny" }]} />
            </div>
          </div>

          <div className="cols c-1-1-1">
            <div className="card">
              <div className="card-head"><h3>Most blocked tools</h3></div>
              <Bars rows={topTools} cls="bad" />
            </div>
            <div className="card">
              <div className="card-head"><h3>Top spenders</h3></div>
              <Bars rows={topSpend} />
            </div>
            <div className="card">
              <div className="card-head"><h3>Needs approval</h3><button className="sm ghost" onClick={() => setView("approvals")}>View all</button></div>
              {approvals.length === 0 ? <div className="empty sm">All clear 🎉</div> : (
                <ul className="mini">{approvals.slice(0, 4).map((ap) => (
                  <li key={ap.id}><div><span className="chip tool">{ap.tool}</span><small className="muted"> cost {ap.cost} · {ago(ap.createdAt)}</small></div>
                    <div className="row"><button className="ok sm" onClick={() => resolve(ap.id, true)}>✓</button><button className="danger sm" onClick={() => resolve(ap.id, false)}>✕</button></div></li>
                ))}</ul>
              )}
            </div>
          </div>

          <div className="card nopad">
            <div className="card-head pad"><h3>Recent activity</h3><button className="sm ghost" onClick={() => setView("audit")}>Open audit log</button></div>
            {LogTable({ rows: audit.slice(0, 8) })}
          </div>
        </>)}

        {view === "agents" && (<>
          <div className="toolbar">
            <label className="search">{I.search}<input placeholder="Search agents by name or id…" value={q} onChange={(e) => { setQ(e.target.value); setShowN(12); }} aria-label="Search agents" /></label>
            <div className="seg">
              <button className={layout === "grid" ? "on" : ""} onClick={() => setLayout("grid")} aria-label="Grid view">{I.tiles}</button>
              <button className={layout === "list" ? "on" : ""} onClick={() => setLayout("list")} aria-label="List view">{I.list}</button>
            </div>
          </div>
          {!loaded && <div className="grid"><div className="skel" /><div className="skel" /><div className="skel" /></div>}
          {loaded && filteredAgents.length === 0 && <div className="card empty">{I.bot}<b>{agents.length ? "No matches" : "No agents yet"}</b>{agents.length ? "Try a different search." : "Click “Run demo” or create your own."}</div>}
          {layout === "grid" ? (
            <div className="grid">{filteredAgents.slice(0, showN).map((a) => <div key={a.id} style={{ display: "contents" }}>{AgentCard({ a })}</div>)}</div>
          ) : (
            <div className="card nopad tablewrap"><table>
              <thead><tr><th>Agent</th><th>Status</th><th>Spend</th><th>Limits</th><th></th></tr></thead>
              <tbody>{filteredAgents.slice(0, showN).map((a) => {
                const pct = a.policy.budget > 0 ? Math.min(100, (a.spent / a.policy.budget) * 100) : 100;
                return (<tr key={a.id}>
                  <td><strong>{a.name}</strong> <span className="mono muted">{a.id.slice(0, 8)}</span></td>
                  <td><span className={`pill ${a.status}`}>{a.status}</span></td>
                  <td style={{ minWidth: 160 }}><div className="meter-wrap"><span><b style={{ fontSize: 13 }}>{a.spent}</b> / {a.policy.budget}</span></div><div className="meter"><i className={pct >= 90 ? "hot" : pct >= 70 ? "mid" : ""} style={{ width: `${pct}%` }} /></div></td>
                  <td className="muted mono">cap {a.policy.maxCostPerAction} · {a.policy.rateLimitPerMin}/min</td>
                  <td><div className="row" style={{ justifyContent: "flex-end" }}>
                    {a.status === "active"
                      ? <button className="danger sm" onClick={() => { if (window.confirm(`Revoke “${a.name}”?`)) act(() => api(`/api/agents/${a.id}`, { method: "PATCH", body: JSON.stringify({ status: "revoked" }) }), `${a.name} revoked`); }}>Kill</button>
                      : <button className="ok sm" onClick={() => act(() => api(`/api/agents/${a.id}`, { method: "PATCH", body: JSON.stringify({ status: "active" }) }), "Reinstated")}>Reinstate</button>}
                    <button className="sm" onClick={() => setEditing(a)}>Edit</button></div></td>
                </tr>);
              })}</tbody></table></div>
          )}
          {filteredAgents.length > showN && <div className="more"><button onClick={() => setShowN((n) => n + 12)}>Show more ({filteredAgents.length - showN} remaining)</button></div>}
        </>)}

        {view === "approvals" && <div className="card nopad">{ApprovalList({ items: approvals })}</div>}

        {view === "audit" && (<>
          <div className="toolbar">
            <div className="seg" role="tablist" aria-label="Filter audit log">
              {(["all", "allow", "pending", "deny"] as const).map((f) => (
                <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f} <span className="n">{countOf(f)}</span></button>
              ))}
            </div>
          </div>
          <div className="card nopad scroll-y">{LogTable({ rows: visibleLog })}</div>
        </>)}

        {editing && (
          <PolicyModal
            agent={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
            onSave={async (name, policy) => {
              if (editing === "new") {
                const r = await api<{ agent: PublicAgent; apiKey: string }>("/api/agents", { method: "POST", body: JSON.stringify({ name, policy }) });
                setNewKey({ name: r.agent.name, key: r.apiKey });
                toast("Agent created", "ok");
              } else {
                await api(`/api/agents/${editing.id}`, { method: "PATCH", body: JSON.stringify({ policy }) });
                toast("Policy saved", "ok");
              }
              setEditing(null);
              await refresh();
            }}
          />
        )}
      </main>

      <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`toast ${t.kind ?? ""}`}>{t.msg}</div>)}</div>
    </div>
  );
}

function PolicyModal({ agent, onClose, onSave }: {
  agent: PublicAgent | null; onClose: () => void; onSave: (name: string, policy: Partial<Policy>) => Promise<void>;
}) {
  const p = agent?.policy;
  const [name, setName] = useState(agent?.name ?? "");
  const [budget, setBudget] = useState(String(p?.budget ?? 500));
  const [cap, setCap] = useState(String(p?.maxCostPerAction ?? 100));
  const [above, setAbove] = useState(p?.approvalAboveCost == null ? "" : String(p.approvalAboveCost));
  const [rate, setRate] = useState(String(p?.rateLimitPerMin ?? 60));
  const [allowed, setAllowed] = useState((p?.allowedTools ?? ["*"]).join(", "));
  const [blocked, setBlocked] = useState((p?.blockedTools ?? []).join(", "));
  const [approval, setApproval] = useState((p?.approvalTools ?? []).join(", "));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const submit = async () => {
    if (!agent && !name.trim()) return setErr("Give the agent a name.");
    const nums = [budget, cap, rate].map(Number);
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return setErr("Budget, cap and rate must be non-negative numbers.");
    if (above.trim() !== "" && !(Number(above) >= 0)) return setErr("Approval threshold must be a number or empty.");
    setBusy(true);
    try {
      await onSave(name, {
        budget: nums[0], maxCostPerAction: nums[1], rateLimitPerMin: Math.max(1, nums[2]),
        approvalAboveCost: above.trim() === "" ? null : Number(above),
        allowedTools: list(allowed).length ? list(allowed) : ["*"],
        blockedTools: list(blocked), approvalTools: list(approval),
      });
    } catch (e) { setErr(e instanceof Error ? e.message : "Save failed"); setBusy(false); }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={agent ? "Edit policy" : "New agent"} onClick={(e) => e.stopPropagation()}>
        <h2>{agent ? `Edit policy · ${agent.name}` : "New agent"}</h2>
        <p className="lead">{agent ? "Changes apply to the next check." : "You’ll get an API key once the agent is created."}</p>
        {!agent && (<><label htmlFor="n">Agent name</label><input id="n" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></>)}
        <div className="two">
          <div><label htmlFor="b">Total budget</label><input id="b" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
          <div><label htmlFor="c">Max per action</label><input id="c" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} /></div>
          <div><label htmlFor="a">Approval above cost (blank = off)</label><input id="a" inputMode="decimal" value={above} onChange={(e) => setAbove(e.target.value)} /></div>
          <div><label htmlFor="r">Calls per minute</label><input id="r" inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
        </div>
        <label htmlFor="al">Allowed tools (comma separated, * = any)</label><input id="al" value={allowed} onChange={(e) => setAllowed(e.target.value)} />
        <label htmlFor="bl">Blocked tools</label><input id="bl" value={blocked} onChange={(e) => setBlocked(e.target.value)} placeholder="delete_database, wire_transfer" />
        <label htmlFor="ap">Always need human approval</label><input id="ap" value={approval} onChange={(e) => setApproval(e.target.value)} placeholder="send_email" />
        {err && <div className="err" role="alert">{err}</div>}
        <div className="row" style={{ marginTop: 20, justifyContent: "flex-end" }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy} onClick={submit}>{agent ? "Save" : "Create agent"}</button>
        </div>
      </div>
    </div>
  );
}
