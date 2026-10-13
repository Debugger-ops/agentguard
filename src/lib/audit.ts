import { createHash } from "crypto";
import type { AuditEntry, Db } from "./types";

export const GENESIS_HASH = "0".repeat(64);

type NewEntry = Omit<AuditEntry, "seq" | "ts" | "prevHash" | "hash">;

function hashEntry(e: Omit<AuditEntry, "hash">): string {
  // Fixed key order so the hash is deterministic.
  const payload = JSON.stringify([
    e.seq, e.ts, e.event, e.agentId, e.tool, e.cost, e.decision,
    e.reason, e.approvalId, e.detail, e.prevHash,
  ]);
  return createHash("sha256").update(payload).digest("hex");
}

/** Append a hash-chained entry. Each entry commits to the one before it. */
export function appendAudit(db: Db, entry: NewEntry, now = new Date()): AuditEntry {
  const last = db.audit[db.audit.length - 1];
  const base = {
    seq: last ? last.seq + 1 : 1,
    ts: now.toISOString(),
    ...entry,
    prevHash: last ? last.hash : GENESIS_HASH,
  };
  const full: AuditEntry = { ...base, hash: hashEntry(base) };
  db.audit.push(full);
  return full;
}

export interface ChainVerification {
  ok: boolean;
  length: number;
  brokenAtSeq: number | null;
  problem: string | null;
}

/** Recompute every hash. Any edit, deletion or reorder breaks the chain. */
export function verifyChain(audit: AuditEntry[]): ChainVerification {
  let prev = GENESIS_HASH;
  for (let i = 0; i < audit.length; i++) {
    const e = audit[i];
    if (e.seq !== i + 1) {
      return { ok: false, length: audit.length, brokenAtSeq: e.seq, problem: "sequence gap or reorder" };
    }
    if (e.prevHash !== prev) {
      return { ok: false, length: audit.length, brokenAtSeq: e.seq, problem: "previous-hash mismatch" };
    }
    const { hash, ...rest } = e;
    if (hashEntry(rest) !== hash) {
      return { ok: false, length: audit.length, brokenAtSeq: e.seq, problem: "entry content was modified" };
    }
    prev = hash;
  }
  return { ok: true, length: audit.length, brokenAtSeq: null, problem: null };
}
