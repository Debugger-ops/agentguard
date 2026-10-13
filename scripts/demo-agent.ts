/**
 * Demo: a pretend AI agent whose tools are wrapped by AgentGuard.
 *
 *   1. npm run dev                 (in another terminal)
 *   2. npm run demo                (waits for you to approve in the dashboard)
 *      npm run demo -- --auto      (auto-approves so it runs unattended)
 */
import { AgentGuard, GuardDeniedError } from "../sdk";

const BASE = process.env.AGENTGUARD_URL ?? "http://localhost:3000";
const AUTO = process.argv.includes("--auto");

async function main() {
  // 1. Register an agent with a policy.
  const res = await fetch(`${BASE}/api/agents`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Demo Support Agent",
      policy: {
        blockedTools: ["delete_customer"],
        approvalTools: ["send_refund"],
        maxCostPerAction: 100,
        budget: 150,
      },
    }),
  });
  if (!res.ok) throw new Error(`Is the dev server running at ${BASE}? (${res.status})`);
  const { agent, apiKey } = (await res.json()) as { agent: { id: string; name: string }; apiKey: string };
  console.log(`Created agent "${agent.name}". Open ${BASE} to watch.\n`);

  const guard = new AgentGuard({ baseUrl: BASE, apiKey, approvalTimeoutMs: 2 * 60_000, pollIntervalMs: 1000 });

  // 2. Your real tools: wrapped so every call goes through the guard.
  const lookupOrder = guard.wrap("lookup_order", async (id: string) => `order ${id}: shipped`, { cost: 0 });
  const sendRefund = guard.wrap("send_refund", async (amount: number) => `refunded ${amount}`, { cost: (amount: number) => amount });
  const deleteCustomer = guard.wrap("delete_customer", async (id: string) => `deleted ${id}`);

  const attempt = async (label: string, fn: () => Promise<string>) => {
    try {
      console.log(`✅ ${label} → ${await fn()}`);
    } catch (e) {
      if (e instanceof GuardDeniedError) console.log(`⛔ ${label} → blocked: ${e.reason}`);
      else throw e;
    }
  };

  await attempt("lookup_order(A-1001)", () => lookupOrder("A-1001"));
  await attempt("delete_customer(C-9)", () => deleteCustomer("C-9"));
  await attempt("send_refund(250)  [over per-action cap]", () => sendRefund(250));

  console.log("\n⏳ send_refund(60) needs human approval...");
  let timer: ReturnType<typeof setInterval> | undefined;
  if (AUTO) {
    // Simulate a human clicking Approve in the dashboard.
    timer = setInterval(async () => {
      const { approvals } = (await (await fetch(`${BASE}/api/approvals?status=pending`)).json()) as { approvals: { id: string; agentId: string }[] };
      for (const a of approvals.filter((x) => x.agentId === agent.id)) {
        await fetch(`${BASE}/api/approvals/${a.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approve: true }) });
      }
    }, 1500);
  } else {
    console.log(`   Go to ${BASE} and click Approve (or Deny).`);
  }
  await attempt("send_refund(60)", () => sendRefund(60));
  await attempt("send_refund(60) again", () => sendRefund(60));
  await attempt("send_refund(60) third [budget 150 exhausted]", () => sendRefund(60));

  if (timer) clearInterval(timer);
  const audit = (await (await fetch(`${BASE}/api/audit?limit=1`)).json()) as { chain: { ok: boolean; length: number } };
  console.log(`\nAudit chain verified: ${audit.chain.ok} (${audit.chain.length} entries)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
