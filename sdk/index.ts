/**
 * AgentGuard SDK: zero dependencies, works in Node 18+ and the browser.
 *
 *   const guard = new AgentGuard({ baseUrl: "http://localhost:3000", apiKey: process.env.AGENTGUARD_KEY! });
 *   const sendEmail = guard.wrap("send_email", realSendEmail, { cost: 1 });
 *   await sendEmail({ to: "x@y.z" });   // throws GuardDeniedError if policy says no
 */

export type Decision = "allow" | "deny" | "pending";

export interface CheckResponse {
  decision: Decision;
  reason: string;
  message: string;
  approvalId?: string;
}

export class GuardDeniedError extends Error {
  constructor(public tool: string, public reason: string, message: string) {
    super(`AgentGuard blocked "${tool}": ${message} (${reason})`);
    this.name = "GuardDeniedError";
  }
}

export interface AgentGuardOptions {
  baseUrl: string;
  apiKey: string;
  /** How long to wait for a human approval before giving up. Default 5 min. */
  approvalTimeoutMs?: number;
  /** Poll interval while waiting for approval. Default 1.5 s. */
  pollIntervalMs?: number;
  /**
   * What to do if the guard server is unreachable.
   * "closed" (default) blocks the action. Safer: an outage never silently
   * lets an agent act without oversight.
   */
  onUnreachable?: "closed" | "open";
}

export class AgentGuard {
  private o: Required<AgentGuardOptions>;

  constructor(options: AgentGuardOptions) {
    this.o = {
      approvalTimeoutMs: 5 * 60_000,
      pollIntervalMs: 1_500,
      onUnreachable: "closed",
      ...options,
      baseUrl: options.baseUrl.replace(/\/$/, ""),
    };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.o.baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${this.o.apiKey}`, ...(init?.headers ?? {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`AgentGuard HTTP ${res.status}: ${(body as { error?: string }).error ?? "request failed"}`);
    return body as T;
  }

  /** Ask the guard whether a call is allowed. Returns the raw decision. */
  async check(tool: string, args?: unknown, cost = 0): Promise<CheckResponse> {
    return this.request<CheckResponse>("/api/guard/check", { method: "POST", body: JSON.stringify({ tool, args, cost }) });
  }

  /**
   * Check, and if the policy needs a human, wait for the answer.
   * Resolves only when the action is allowed; otherwise throws GuardDeniedError.
   */
  async authorize(tool: string, args?: unknown, cost = 0): Promise<void> {
    let res: CheckResponse;
    try {
      res = await this.check(tool, args, cost);
    } catch (e) {
      if (this.o.onUnreachable === "open" && !(e instanceof Error && e.message.startsWith("AgentGuard HTTP"))) return;
      throw new GuardDeniedError(tool, "guard_unreachable", e instanceof Error ? e.message : "guard unreachable");
    }
    if (res.decision === "allow") return;
    if (res.decision === "deny") throw new GuardDeniedError(tool, res.reason, res.message);

    // pending: poll for the human decision
    const deadline = Date.now() + this.o.approvalTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, this.o.pollIntervalMs));
      const s = await this.request<{ status: "pending" | "approved" | "denied"; reason: string }>(
        `/api/guard/approvals/${res.approvalId}`,
      );
      if (s.status === "approved") return;
      if (s.status === "denied") throw new GuardDeniedError(tool, s.reason, "A human denied this action.");
    }
    throw new GuardDeniedError(tool, "approval_timeout", "Timed out waiting for human approval.");
  }

  /** Wrap any async tool function so it is checked before it runs. */
  wrap<A extends unknown[], R>(
    tool: string,
    fn: (...args: A) => Promise<R> | R,
    opts: { cost?: number | ((...args: A) => number) } = {},
  ): (...args: A) => Promise<R> {
    return async (...args: A) => {
      const cost = typeof opts.cost === "function" ? opts.cost(...args) : opts.cost ?? 0;
      await this.authorize(tool, args.length === 1 ? args[0] : args, cost);
      return fn(...args);
    };
  }
}
