import { listApprovals } from "@/lib/service";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status");
  const ok = status === "pending" || status === "approved" || status === "denied";
  return json({ approvals: listApprovals(ok ? status : undefined) });
}
