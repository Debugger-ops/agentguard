# AgentGuard

**A control tower for AI agents.** Put one check in front of every tool an agent calls and get:

- **Permissions**: allow-list, block-list, expiry
- **Spend control**: per-action cap, total budget, rate limit
- **Human approval gates**: by tool, or automatically above a cost threshold
- **Kill switch**: revoke an agent instantly; pending approvals are cancelled
- **Tamper-evident audit log**: every decision is hash-chained (SHA-256), so edits, deletions and reordering are detectable
- **Live dashboard** and a tiny **TypeScript SDK**

Stack: Next.js 14 (App Router) + TypeScript. No database to install (JSON file store with atomic writes).

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000
```

Open the dashboard and click **Run demo**: it creates an agent and fires allowed, blocked, over-budget and approval-needed actions at it.

Run a real SDK-wrapped agent in a second terminal:

```bash
npm run demo              # waits for you to click Approve in the dashboard
npm run demo -- --auto    # auto-approves, runs unattended
npm test                  # 17 tests: policy, approvals, kill switch, auth, audit chain
```

## How it works

```
 Your agent ──▶ guard.wrap("send_refund", fn)
                     │  POST /api/guard/check  (Bearer agent key)
                     ▼
              ┌─────────────┐   allow   ─▶ run the tool, spend recorded
              │ Policy      │   deny    ─▶ GuardDeniedError, tool never runs
              │ engine      │   pending ─▶ human clicks Approve/Deny in dashboard
              └─────────────┘              (SDK polls until answered)
                     │
                     ▼
              hash-chained audit log
```

### Decision order (first match wins)

| # | Rule | Result |
|---|------|--------|
| 1 | Agent revoked | deny `agent_revoked` |
| 2 | Policy expired | deny `policy_expired` |
| 3 | Tool in `blockedTools` | deny `tool_blocked` |
| 4 | Tool not in `allowedTools` (and no `*`) | deny `tool_not_allowed` |
| 5 | Calls in last 60 s ≥ `rateLimitPerMin` | deny `rate_limited` |
| 6 | Cost negative / NaN / > `maxCostPerAction` | deny `over_action_cap` |
| 7 | spent + cost > `budget` | deny `over_budget` |
| 8 | Tool in `approvalTools`, or cost > `approvalAboveCost` | pending `approval_required` |
| 9 | otherwise | allow |

Budget and kill-switch are **re-checked at approval time**, so a stale approval can't overspend. Approval requests expire after 10 minutes.

### Policy fields

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `allowedTools` | string[] | `["*"]` | Tools the agent may use |
| `blockedTools` | string[] | `[]` | Always denied (beats allow-list) |
| `approvalTools` | string[] | `[]` | Always need a human |
| `approvalAboveCost` | number \| null | `null` | Human needed when cost is above this |
| `maxCostPerAction` | number | 100 | Hard per-action cap |
| `budget` | number | 500 | Total spend allowed |
| `rateLimitPerMin` | number | 60 | Checks per rolling minute |
| `expiresAt` | ISO string \| null | `null` | Authority ends at this time |

`cost` is in whatever unit you choose (rupees, dollars, tokens, API credits).

## SDK

```ts
import { AgentGuard, GuardDeniedError } from "./sdk";

const guard = new AgentGuard({ baseUrl: "http://localhost:3000", apiKey: process.env.AGENTGUARD_KEY! });

const sendRefund = guard.wrap("send_refund", realSendRefund, { cost: (amount: number) => amount });

try {
  await sendRefund(60);               // waits for human approval if policy requires it
} catch (e) {
  if (e instanceof GuardDeniedError) console.log(e.reason);   // e.g. "over_budget"
}
```

Fail-closed by default: if the guard server is unreachable the action is **blocked** (`onUnreachable: "open"` to change).

## HTTP API

| Method & path | Auth | Purpose |
|---------------|------|---------|
| `POST /api/agents` `{name, policy?}` | none (demo) | Create agent. Returns `apiKey` **once** |
| `GET /api/agents` | none | List agents |
| `PATCH /api/agents/:id` `{policy?, status?, resetSpent?}` | none | Edit policy / kill switch / reset spend |
| `POST /api/guard/check` `{tool, args?, cost?}` | agent key | The guard call |
| `GET /api/guard/approvals/:id` | agent key | Agent polls approval status |
| `GET /api/approvals?status=pending` | none | Dashboard queue |
| `POST /api/approvals/:id` `{approve: bool}` | none | Human decision |
| `GET /api/audit?limit=100` | none | Log + chain verification result |
| `POST /api/demo` | none | Seed a demo agent |

## Security model: read this before real use

What it does well: API keys are stored only as SHA-256 hashes; agents can only poll their own approvals; negative costs cannot refund budget; the audit chain detects edits, deletions and reordering; the SDK fails closed.

**This is a v0.1 prototype. Known limitations:**

1. **Dashboard and admin endpoints have no login.** Anyone who can reach the server can approve actions or revoke agents. Add auth (NextAuth / SSO) before exposing it beyond localhost.
2. **The hash chain is tamper-*evident*, not tamper-*proof*.** Someone with write access to `data/db.json` can recompute the whole chain. For real assurance, periodically anchor the latest hash somewhere external (a separate service, a signed timestamp, a public ledger).
3. **The JSON file store is single-process.** Fine for a demo; for production swap `src/lib/store.ts` for Postgres with transactions.
4. **The guard only controls what goes through it.** An agent that can call tools directly bypasses it. Enforce by giving the agent *only* wrapped tools, or by keeping the real credentials inside the guard rather than the agent.
5. Rate limiting counts audit entries per agent over a rolling 60 s window.

## Project layout

```
src/lib/policy.ts      pure policy engine (no I/O)
src/lib/audit.ts       hash chain + verification
src/lib/service.ts     agents, check, approvals, kill switch
src/lib/store.ts       JSON store, atomic writes (swap for a real DB)
src/app/api/**         route handlers
src/app/page.tsx       dashboard
sdk/index.ts           AgentGuard client
scripts/demo-agent.ts  runnable example
tests/                 vitest suite
```

## Roadmap ideas (where this becomes a product)

- Auth, teams and roles (who may approve what)
- Postgres store and external hash anchoring
- Slack / email / WhatsApp approval buttons
- Policy-as-code (YAML) and dry-run simulation against past logs
- Python SDK, plus adapters for LangChain, OpenAI Agents and MCP servers
- Anomaly alerts (sudden spend spike, new tool usage)
- Scoped, expiring delegation tokens (agent identity)
# agentguard
