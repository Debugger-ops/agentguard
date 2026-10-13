import { authenticate, checkAction } from "@/lib/service";
import { err, json, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * The one call an agent makes before every tool use.
 * Auth: `Authorization: Bearer <agent api key>`.
 */
export async function POST(req: Request) {
  const agent = authenticate(req.headers.get("authorization"));
  if (!agent) return err("invalid or missing API key", 401);

  const body = await readJson<{ tool?: unknown; args?: unknown; cost?: unknown }>(req);
  if (!body || typeof body.tool !== "string" || !body.tool.trim()) return err("tool is required");
  const cost = body.cost === undefined ? 0 : body.cost;
  if (typeof cost !== "number") return err("cost must be a number");

  const result = checkAction(agent.id, body.tool.trim().slice(0, 120), body.args, cost);
  // 200 for every policy outcome: the decision is in the body, not the status code.
  return json(result);
}
