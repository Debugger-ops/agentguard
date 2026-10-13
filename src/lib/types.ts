export type Decision = "allow" | "deny" | "pending";

export type ReasonCode =
  | "ok"
  | "agent_revoked"
  | "policy_expired"
  | "tool_blocked"
  | "tool_not_allowed"
  | "rate_limited"
  | "over_action_cap"
  | "over_budget"
  | "approval_required"
  | "approval_granted"
  | "approval_denied"
  | "approval_expired";

export interface Policy {
  /** Tools the agent may call. "*" allows everything not blocked. */
  allowedTools: string[];
  /** Tools that are always denied (wins over allowedTools). */
  blockedTools: string[];
  /** Tools that always need a human to approve. */
  approvalTools: string[];
  /** Any single action costing more than this needs approval (null = off). */
  approvalAboveCost: number | null;
  /** Hard cap for one action. Above this is denied outright. */
  maxCostPerAction: number;
  /** Total spend allowed over the agent's lifetime (or until reset). */
  budget: number;
  /** Max check requests per rolling 60 seconds. */
  rateLimitPerMin: number;
  /** ISO timestamp after which every call is denied (null = never). */
  expiresAt: string | null;
}

export interface Agent {
  id: string;
  name: string;
  /** SHA-256 of the agent API key. The plaintext key is shown once at creation. */
  apiKeyHash: string;
  status: "active" | "revoked";
  policy: Policy;
  spent: number;
  createdAt: string;
}

export interface Approval {
  id: string;
  agentId: string;
  tool: string;
  args: unknown;
  cost: number;
  status: "pending" | "approved" | "denied";
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export type AuditEvent =
  | "agent_created"
  | "agent_updated"
  | "agent_revoked"
  | "agent_reinstated"
  | "check"
  | "approval_resolved";

export interface AuditEntry {
  seq: number;
  ts: string;
  event: AuditEvent;
  agentId: string;
  tool: string | null;
  cost: number;
  decision: Decision | null;
  reason: ReasonCode | null;
  approvalId: string | null;
  detail: string | null;
  prevHash: string;
  hash: string;
}

export interface Db {
  agents: Agent[];
  approvals: Approval[];
  audit: AuditEntry[];
}

export interface CheckResult {
  decision: Decision;
  reason: ReasonCode;
  approvalId?: string;
  message: string;
}

export const DEFAULT_POLICY: Policy = {
  allowedTools: ["*"],
  blockedTools: [],
  approvalTools: [],
  approvalAboveCost: null,
  maxCostPerAction: 100,
  budget: 500,
  rateLimitPerMin: 60,
  expiresAt: null,
};
