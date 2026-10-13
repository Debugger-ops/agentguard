import { checkAction, createAgent } from "@/lib/service";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * One-click demo: creates an agent and fires a realistic mix of actions at it
 * so the dashboard immediately shows allows, denies and a pending approval.
 */
export async function POST() {
  const { agent, apiKey } = createAgent("Research & Ops Agent", {
    allowedTools: ["web_search", "read_file", "send_email", "transfer_money", "delete_database"],
    blockedTools: ["delete_database"],
    approvalTools: ["send_email"],
    approvalAboveCost: 50,
    maxCostPerAction: 200,
    budget: 300,
    rateLimitPerMin: 30,
  });
  const steps: Array<[string, unknown, number]> = [
    ["web_search", { q: "competitor pricing" }, 2],
    ["read_file", { path: "/reports/q3.pdf" }, 0],
    ["send_email", { to: "ceo@example.com", subject: "Findings" }, 1],
    ["transfer_money", { to: "vendor-42", amount: 80 }, 80],
    ["transfer_money", { to: "vendor-42", amount: 500 }, 500],
    ["delete_database", { name: "prod" }, 0],
    ["browse_dark_web", {}, 0],
  ];
  for (const [tool, args, cost] of steps) checkAction(agent.id, tool, args, cost);
  return json({ agent, apiKey }, 201);
}
