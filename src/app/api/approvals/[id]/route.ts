import { resolveApproval } from "@/lib/service";
import { err, json, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await readJson<{ approve?: unknown }>(req);
  if (!body || typeof body.approve !== "boolean") return err("approve (boolean) is required");
  const ap = resolveApproval(params.id, body.approve);
  return ap ? json({ approval: ap }) : err("not found", 404);
}
