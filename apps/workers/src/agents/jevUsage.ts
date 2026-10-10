import type { D1Database } from "@cloudflare/workers-types";

let prunedDay: string | null = null;

/** Daily caps never consult an earlier UTC day. Prune once per Worker isolate. */
export async function pruneOldJevUsage(db: D1Database, day: string): Promise<void> {
  if (prunedDay === day) return;
  await db.prepare("DELETE FROM jev_usage WHERE day < ?").bind(day).run();
  await db.prepare("DELETE FROM jev_personal_usage WHERE day < ?").bind(day).run();
  prunedDay = day;
}
