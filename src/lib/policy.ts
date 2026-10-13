import type { Agent, AuditEntry, CheckResult } from "./types";

export interface EvalInput {
  tool: string;
  cost: number;
  now: Date;
  /** Number of check requests this agent made in the last 60 seconds. */
  recentChecks: number;
}

/**
 * Pure policy evaluation: no I/O, easy to test.
 * Order matters: the cheapest, most absolute rules run first.
 */
export function evaluate(agent: Agent, input: EvalInput): CheckResult {
  const { policy } = agent;
  const { tool, cost, now, recentChecks } = input;

  if (agent.status === "revoked") {
    return deny("agent_revoked", "Agent has been revoked (kill switch).");
  }
  if (policy.expiresAt && now.getTime() >= new Date(policy.expiresAt).getTime()) {
    return deny("policy_expired", "Agent's authority has expired.");
  }
  if (policy.blockedTools.includes(tool)) {
    return deny("tool_blocked", `Tool "${tool}" is explicitly blocked.`);
  }
  if (!policy.allowedTools.includes("*") && !policy.allowedTools.includes(tool)) {
    return deny("tool_not_allowed", `Tool "${tool}" is not in the allowed list.`);
  }
  if (recentChecks >= policy.rateLimitPerMin) {
    return deny("rate_limited", `Rate limit of ${policy.rateLimitPerMin}/min reached.`);
  }
  if (cost < 0 || !Number.isFinite(cost)) {
    return deny("over_action_cap", "Cost must be a non-negative number.");
  }
  if (cost > policy.maxCostPerAction) {
    return deny("over_action_cap", `Cost ${cost} exceeds the per-action cap of ${policy.maxCostPerAction}.`);
  }
  if (agent.spent + cost > policy.budget) {
    return deny("over_budget", `Would exceed budget: ${agent.spent} spent + ${cost} > ${policy.budget}.`);
  }
  if (policy.approvalTools.includes(tool)) {
    return { decision: "pending", reason: "approval_required", message: `Tool "${tool}" needs human approval.` };
  }
  if (policy.approvalAboveCost !== null && cost > policy.approvalAboveCost) {
    return {
      decision: "pending",
      reason: "approval_required",
      message: `Cost ${cost} is above the approval threshold of ${policy.approvalAboveCost}.`,
    };
  }
  return { decision: "allow", reason: "ok", message: "Allowed by policy." };
}

function deny(reason: CheckResult["reason"], message: string): CheckResult {
  return { decision: "deny", reason, message };
}

/** Count check events for an agent in the trailing 60 seconds. */
export function countRecentChecks(audit: AuditEntry[], agentId: string, now: Date): number {
  const cutoff = now.getTime() - 60_000;
  let n = 0;
  for (let i = audit.length - 1; i >= 0; i--) {
    const e = audit[i];
    if (new Date(e.ts).getTime() < cutoff) break;
    if (e.event === "check" && e.agentId === agentId) n++;
  }
  return n;
}
