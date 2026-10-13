import { createHash, randomBytes, randomUUID } from "crypto";
import { appendAudit, verifyChain } from "./audit";
import { countRecentChecks, evaluate } from "./policy";
import { withDb, loadDb } from "./store";
import {
  DEFAULT_POLICY,
  type Agent,
  type Approval,
  type AuditEntry,
  type CheckResult,
  type Policy,
} from "./types";

export const APPROVAL_TTL_MS = 10 * 60_000;

export type PublicAgent = Omit<Agent, "apiKeyHash">;

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
const toPublic = ({ apiKeyHash: _omit, ...rest }: Agent): PublicAgent => rest;

// ---------- validation ----------

const strList = (v: unknown, fallback: string[]): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : fallback;

const num = (v: unknown, fallback: number, min = 0): number =>
  typeof v === "number" && Number.isFinite(v) && v >= min ? v : fallback;

export function sanitizePolicy(input: Partial<Policy> | undefined, base: Policy = DEFAULT_POLICY): Policy {
  const p = input ?? {};
  let expiresAt: string | null = base.expiresAt;
  if (p.expiresAt === null) expiresAt = null;
  else if (typeof p.expiresAt === "string" && !Number.isNaN(Date.parse(p.expiresAt))) expiresAt = p.expiresAt;
  let approvalAboveCost: number | null = base.approvalAboveCost;
  if (p.approvalAboveCost === null) approvalAboveCost = null;
  else if (typeof p.approvalAboveCost === "number" && p.approvalAboveCost >= 0) approvalAboveCost = p.approvalAboveCost;
  return {
    allowedTools: strList(p.allowedTools, base.allowedTools),
    blockedTools: strList(p.blockedTools, base.blockedTools),
    approvalTools: strList(p.approvalTools, base.approvalTools),
    approvalAboveCost,
    maxCostPerAction: num(p.maxCostPerAction, base.maxCostPerAction),
    budget: num(p.budget, base.budget),
    rateLimitPerMin: Math.floor(num(p.rateLimitPerMin, base.rateLimitPerMin, 1)),
    expiresAt,
  };
}

// ---------- agents ----------

export function createAgent(name: string, policy?: Partial<Policy>): { agent: PublicAgent; apiKey: string } {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new Error("name is required");
  const apiKey = `ag_${randomBytes(24).toString("hex")}`;
  const agent: Agent = {
    id: randomUUID(),
    name: clean,
    apiKeyHash: hashKey(apiKey),
    status: "active",
    policy: sanitizePolicy(policy),
    spent: 0,
    createdAt: new Date().toISOString(),
  };
  withDb((db) => {
    db.agents.push(agent);
    appendAudit(db, {
      event: "agent_created", agentId: agent.id, tool: null, cost: 0,
      decision: null, reason: null, approvalId: null, detail: `Agent "${agent.name}" created`,
    });
  });
  return { agent: toPublic(agent), apiKey };
}

export function listAgents(): PublicAgent[] {
  return loadDb().agents.map(toPublic);
}

export function getAgent(id: string): PublicAgent | null {
  const a = loadDb().agents.find((x) => x.id === id);
  return a ? toPublic(a) : null;
}

export function authenticate(authHeader: string | null): Agent | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const h = hashKey(authHeader.slice(7).trim());
  return loadDb().agents.find((a) => a.apiKeyHash === h) ?? null;
}

export function updateAgent(
  id: string,
  patch: { policy?: Partial<Policy>; status?: "active" | "revoked"; resetSpent?: boolean },
): PublicAgent | null {
  return withDb((db) => {
    const agent = db.agents.find((a) => a.id === id);
    if (!agent) return null;
    if (patch.policy) {
      agent.policy = sanitizePolicy(patch.policy, agent.policy);
      appendAudit(db, {
        event: "agent_updated", agentId: id, tool: null, cost: 0,
        decision: null, reason: null, approvalId: null, detail: "Policy updated",
      });
    }
    if (patch.resetSpent) {
      agent.spent = 0;
      appendAudit(db, {
        event: "agent_updated", agentId: id, tool: null, cost: 0,
        decision: null, reason: null, approvalId: null, detail: "Spend counter reset",
      });
    }
    if (patch.status && patch.status !== agent.status) {
      agent.status = patch.status;
      if (patch.status === "revoked") {
        // Revoking also cancels anything waiting for approval.
        for (const ap of db.approvals) {
          if (ap.agentId === id && ap.status === "pending") {
            ap.status = "denied";
            ap.resolvedAt = new Date().toISOString();
            ap.resolvedBy = "system:revoked";
          }
        }
      }
      appendAudit(db, {
        event: patch.status === "revoked" ? "agent_revoked" : "agent_reinstated",
        agentId: id, tool: null, cost: 0, decision: null, reason: null, approvalId: null,
        detail: patch.status === "revoked" ? "Kill switch activated" : "Agent reinstated",
      });
    }
    return toPublic(agent);
  });
}

// ---------- the guard ----------

const MAX_ARGS_CHARS = 2000;
function snapshotArgs(args: unknown): unknown {
  try {
    const s = JSON.stringify(args ?? null);
    return s.length > MAX_ARGS_CHARS ? { truncated: s.slice(0, MAX_ARGS_CHARS) } : args ?? null;
  } catch {
    return { unserializable: true };
  }
}

export function checkAction(agentId: string, tool: string, args: unknown, cost: number, now = new Date()): CheckResult {
  return withDb((db) => {
    const agent = db.agents.find((a) => a.id === agentId);
    if (!agent) throw new Error("unknown agent");

    const recent = countRecentChecks(db.audit, agentId, now);
    const result = evaluate(agent, { tool, cost, now, recentChecks: recent });

    let approvalId: string | null = null;
    if (result.decision === "allow") {
      agent.spent += cost;
    } else if (result.decision === "pending") {
      const ap: Approval = {
        id: randomUUID(), agentId, tool, args: snapshotArgs(args), cost,
        status: "pending", createdAt: now.toISOString(), resolvedAt: null, resolvedBy: null,
      };
      db.approvals.push(ap);
      approvalId = ap.id;
    }

    appendAudit(db, {
      event: "check", agentId, tool, cost,
      decision: result.decision, reason: result.reason, approvalId, detail: result.message,
    }, now);

    return approvalId ? { ...result, approvalId } : result;
  });
}

// ---------- approvals ----------

export function listApprovals(status?: Approval["status"]): Approval[] {
  const all = loadDb().approvals;
  return (status ? all.filter((a) => a.status === status) : all).slice().reverse();
}

/** Human decision. Budget and kill-switch are re-checked at approval time. */
export function resolveApproval(id: string, approve: boolean, by = "dashboard", now = new Date()): Approval | null {
  return withDb((db) => {
    const ap = db.approvals.find((a) => a.id === id);
    if (!ap) return null;
    if (ap.status !== "pending") return ap; // already resolved: idempotent
    const agent = db.agents.find((a) => a.id === ap.agentId);

    let finalApprove = approve;
    let reason: AuditEntry["reason"] = approve ? "approval_granted" : "approval_denied";
    let detail = approve ? `Approved by ${by}` : `Denied by ${by}`;

    if (finalApprove) {
      if (!agent || agent.status === "revoked") {
        finalApprove = false; reason = "agent_revoked"; detail = "Agent was revoked before approval";
      } else if (now.getTime() - new Date(ap.createdAt).getTime() > APPROVAL_TTL_MS) {
        finalApprove = false; reason = "approval_expired"; detail = "Approval request expired";
      } else if (agent.spent + ap.cost > agent.policy.budget) {
        finalApprove = false; reason = "over_budget"; detail = "Budget no longer allows this action";
      }
    }

    if (finalApprove && agent) agent.spent += ap.cost;
    ap.status = finalApprove ? "approved" : "denied";
    ap.resolvedAt = now.toISOString();
    ap.resolvedBy = by;

    appendAudit(db, {
      event: "approval_resolved", agentId: ap.agentId, tool: ap.tool, cost: ap.cost,
      decision: finalApprove ? "allow" : "deny", reason, approvalId: ap.id, detail,
    }, now);
    return ap;
  });
}

/** What the agent sees when polling. Expires stale requests lazily. */
export function pollApproval(agentId: string, approvalId: string, now = new Date()): { status: Approval["status"]; reason: string } | null {
  const ap = loadDb().approvals.find((a) => a.id === approvalId && a.agentId === agentId);
  if (!ap) return null;
  if (ap.status === "pending" && now.getTime() - new Date(ap.createdAt).getTime() > APPROVAL_TTL_MS) {
    const r = resolveApproval(approvalId, false, "system:expired", now);
    return { status: r?.status ?? "denied", reason: "approval_expired" };
  }
  return { status: ap.status, reason: ap.status === "approved" ? "approval_granted" : ap.status === "denied" ? "approval_denied" : "approval_required" };
}

// ---------- audit ----------

export function listAudit(limit = 200): AuditEntry[] {
  return loadDb().audit.slice(-limit).reverse();
}

export function chainStatus() {
  return verifyChain(loadDb().audit);
}
