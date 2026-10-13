import fs from "fs";
import path from "path";
import type { Db } from "./types";

function dbPath(): string {
  return process.env.AGENTGUARD_DB || path.join(process.cwd(), "data", "db.json");
}

const empty = (): Db => ({ agents: [], approvals: [], audit: [] });

/** Load the whole DB. Synchronous on purpose: one process, no interleaving. */
export function loadDb(): Db {
  const p = dbPath();
  try {
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as Db;
    return { agents: parsed.agents ?? [], approvals: parsed.approvals ?? [], audit: parsed.audit ?? [] };
  } catch {
    return empty();
  }
}

/** Atomic write: write temp file then rename, so a crash never leaves half a file. */
export function saveDb(db: Db): void {
  const p = dbPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, p);
}

/** Run a mutation against a fresh copy and persist it. */
export function withDb<T>(fn: (db: Db) => T): T {
  const db = loadDb();
  const result = fn(db);
  saveDb(db);
  return result;
}
