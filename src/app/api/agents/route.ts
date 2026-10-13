import { createAgent, listAgents } from "@/lib/service";
import { err, json, readJson } from "@/lib/http";
import type { Policy } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return json({ agents: listAgents() });
}

/** Create an agent. The API key is returned ONCE and only its hash is stored. */
export async function POST(req: Request) {
  const body = await readJson<{ name?: string; policy?: Partial<Policy> }>(req);
  if (!body || typeof body.name !== "string" || !body.name.trim()) return err("name is required");
  const { agent, apiKey } = createAgent(body.name, body.policy);
  return json({ agent, apiKey }, 201);
}
