import { authenticate, pollApproval } from "@/lib/service";
import { err, json } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Agents poll this while waiting for a human decision. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const agent = authenticate(req.headers.get("authorization"));
  if (!agent) return err("invalid or missing API key", 401);
  const r = pollApproval(agent.id, params.id);
  return r ? json(r) : err("not found", 404);
}
