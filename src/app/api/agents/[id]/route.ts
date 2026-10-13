import { getAgent, updateAgent } from "@/lib/service";
import { err, json, readJson } from "@/lib/http";
import type { Policy } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const agent = getAgent(params.id);
  return agent ? json({ agent }) : err("not found", 404);
}

/** Update policy, revoke / reinstate (kill switch), or reset the spend counter. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const body = await readJson<{ policy?: Partial<Policy>; status?: string; resetSpent?: boolean }>(req);
  if (!body) return err("invalid JSON body");
  if (body.status !== undefined && body.status !== "active" && body.status !== "revoked") {
    return err('status must be "active" or "revoked"');
  }
  const agent = updateAgent(params.id, {
    policy: body.policy,
    status: body.status as "active" | "revoked" | undefined,
    resetSpent: body.resetSpent === true,
  });
  return agent ? json({ agent }) : err("not found", 404);
}
