import { chainStatus, listAudit } from "@/lib/service";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limit = Math.min(500, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 100));
  return json({ entries: listAudit(limit), chain: chainStatus() });
}
