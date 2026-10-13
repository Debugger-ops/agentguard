import { beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { verifyChain } from "@/lib/audit";
import { loadDb, saveDb } from "@/lib/store";
import {
  authenticate, checkAction, chainStatus, createAgent, listApprovals,
  pollApproval, resolveApproval, updateAgent, APPROVAL_TTL_MS, getAgent,
} from "@/lib/service";

beforeEach(() => {
  process.env.AGENTGUARD_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ag-")), "db.json");
});

const mk = (policy = {}) =>
  createAgent("test-agent", { budget: 100, maxCostPerAction: 50, ...policy });

describe("policy decisions", () => {
  it("allows a normal call and tracks spend", () => {
    const { agent } = mk();
    const r = checkAction(agent.id, "search", {}, 10);
    expect(r.decision).toBe("allow");
    expect(getAgent(agent.id)!.spent).toBe(10);
  });

  it("denies blocked tools even if allowedTools is *", () => {
    const { agent } = mk({ blockedTools: ["drop_db"] });
    expect(checkAction(agent.id, "drop_db", {}, 0)).toMatchObject({ decision: "deny", reason: "tool_blocked" });
  });

  it("enforces an allow-list", () => {
    const { agent } = mk({ allowedTools: ["search"] });
    expect(checkAction(agent.id, "search", {}, 0).decision).toBe("allow");
    expect(checkAction(agent.id, "email", {}, 0)).toMatchObject({ decision: "deny", reason: "tool_not_allowed" });
  });

  it("enforces per-action cap and total budget", () => {
    const { agent } = mk();
    expect(checkAction(agent.id, "pay", {}, 60)).toMatchObject({ decision: "deny", reason: "over_action_cap" });
    expect(checkAction(agent.id, "pay", {}, 50).decision).toBe("allow");
    expect(checkAction(agent.id, "pay", {}, 50).decision).toBe("allow");
    expect(checkAction(agent.id, "pay", {}, 1)).toMatchObject({ decision: "deny", reason: "over_budget" });
  });

  it("rejects negative / NaN costs (cannot refund budget)", () => {
    const { agent } = mk();
    expect(checkAction(agent.id, "pay", {}, -50).decision).toBe("deny");
    expect(checkAction(agent.id, "pay", {}, NaN).decision).toBe("deny");
    expect(getAgent(agent.id)!.spent).toBe(0);
  });

  it("rate limits within a rolling minute", () => {
    const { agent } = mk({ rateLimitPerMin: 3 });
    const t = new Date();
    for (let i = 0; i < 3; i++) expect(checkAction(agent.id, "s", {}, 0, t).decision).toBe("allow");
    expect(checkAction(agent.id, "s", {}, 0, t)).toMatchObject({ decision: "deny", reason: "rate_limited" });
    const later = new Date(t.getTime() + 61_000);
    expect(checkAction(agent.id, "s", {}, 0, later).decision).toBe("allow");
  });

  it("denies after expiry", () => {
    const { agent } = mk({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(checkAction(agent.id, "s", {}, 0)).toMatchObject({ decision: "deny", reason: "policy_expired" });
  });
});

describe("approvals", () => {
  it("creates a pending approval for approval tools and spends only after approval", () => {
    const { agent } = mk({ approvalTools: ["send_email"] });
    const r = checkAction(agent.id, "send_email", { to: "a@b.c" }, 5);
    expect(r.decision).toBe("pending");
    expect(getAgent(agent.id)!.spent).toBe(0);
    expect(pollApproval(agent.id, r.approvalId!)!.status).toBe("pending");

    resolveApproval(r.approvalId!, true);
    expect(getAgent(agent.id)!.spent).toBe(5);
    expect(pollApproval(agent.id, r.approvalId!)!.status).toBe("approved");
  });

  it("requires approval above a cost threshold", () => {
    const { agent } = mk({ approvalAboveCost: 20 });
    expect(checkAction(agent.id, "pay", {}, 20).decision).toBe("allow");
    expect(checkAction(agent.id, "pay", {}, 21).decision).toBe("pending");
  });

  it("approving twice does not double-charge", () => {
    const { agent } = mk({ approvalTools: ["pay"] });
    const r = checkAction(agent.id, "pay", {}, 10);
    resolveApproval(r.approvalId!, true);
    resolveApproval(r.approvalId!, true);
    expect(getAgent(agent.id)!.spent).toBe(10);
  });

  it("refuses to approve if budget was consumed in the meantime", () => {
    const { agent } = mk({ approvalTools: ["pay"], budget: 50 });
    const pending = checkAction(agent.id, "pay", {}, 40);
    updateAgent(agent.id, { policy: { approvalTools: [] } });
    expect(checkAction(agent.id, "pay", {}, 40).decision).toBe("allow"); // uses 40/50
    const res = resolveApproval(pending.approvalId!, true);
    expect(res!.status).toBe("denied");
    expect(getAgent(agent.id)!.spent).toBe(40);
  });

  it("expires stale approvals", () => {
    const { agent } = mk({ approvalTools: ["pay"] });
    const t0 = new Date();
    const r = checkAction(agent.id, "pay", {}, 5, t0);
    const later = new Date(t0.getTime() + APPROVAL_TTL_MS + 1000);
    expect(pollApproval(agent.id, r.approvalId!, later)!.status).toBe("denied");
  });

  it("an agent cannot poll another agent's approval", () => {
    const a = mk({ approvalTools: ["pay"] });
    const b = mk();
    const r = checkAction(a.agent.id, "pay", {}, 5);
    expect(pollApproval(b.agent.id, r.approvalId!)).toBeNull();
  });
});

describe("kill switch", () => {
  it("revoking denies new calls and cancels pending approvals", () => {
    const { agent } = mk({ approvalTools: ["pay"] });
    const r = checkAction(agent.id, "pay", {}, 5);
    updateAgent(agent.id, { status: "revoked" });
    expect(listApprovals("pending")).toHaveLength(0);
    expect(pollApproval(agent.id, r.approvalId!)!.status).toBe("denied");
    expect(checkAction(agent.id, "search", {}, 0)).toMatchObject({ decision: "deny", reason: "agent_revoked" });
    updateAgent(agent.id, { status: "active" });
    expect(checkAction(agent.id, "search", {}, 0).decision).toBe("allow");
  });
});

describe("auth", () => {
  it("authenticates by key and never stores plaintext", () => {
    const { agent, apiKey } = mk();
    expect(authenticate(`Bearer ${apiKey}`)?.id).toBe(agent.id);
    expect(authenticate("Bearer nope")).toBeNull();
    expect(authenticate(null)).toBeNull();
    expect(fs.readFileSync(process.env.AGENTGUARD_DB!, "utf8")).not.toContain(apiKey);
  });
});

describe("tamper-evident audit log", () => {
  it("verifies a clean chain", () => {
    const { agent } = mk();
    checkAction(agent.id, "search", {}, 1);
    expect(chainStatus()).toMatchObject({ ok: true });
  });

  it("detects edited, deleted and reordered entries", () => {
    const { agent } = mk();
    for (let i = 0; i < 4; i++) checkAction(agent.id, "search", {}, 1);

    const edited = loadDb();
    edited.audit[2].cost = 0;
    expect(verifyChain(edited.audit)).toMatchObject({ ok: false, brokenAtSeq: 3, problem: "entry content was modified" });

    const deleted = loadDb();
    deleted.audit.splice(2, 1);
    expect(verifyChain(deleted.audit).ok).toBe(false);

    const reordered = loadDb();
    [reordered.audit[1], reordered.audit[2]] = [reordered.audit[2], reordered.audit[1]];
    expect(verifyChain(reordered.audit).ok).toBe(false);

    saveDb(edited);
    expect(chainStatus().ok).toBe(false);
  });
});
