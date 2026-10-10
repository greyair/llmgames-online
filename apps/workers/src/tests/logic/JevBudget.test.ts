import { testEnv } from "../fixtures/env";
import { SQLiteD1 } from "../fixtures/sqlite-d1";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { claimSponsoredJevTrial, hasSponsoredJevTrial, reserveJevCall } from "../../agents/jev";

afterEach(() => vi.useRealTimers());

function migratedDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  const directory = new URL("../../../migrations/", import.meta.url);

  for (const file of readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  }

  return db;
}

it("atomically caps global and host requests and resets each UTC day", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-18T12:00:00Z"));
  const db = migratedDb();

  const env = testEnv({
    JEV_DAILY_CALL_LIMIT: "4",
    JEV_USER_DAILY_CALL_LIMIT: "2",
    DB: new SQLiteD1(db),
  });

  try {
    const first = await Promise.all(Array.from({ length: 4 }, () => reserveJevCall(env, "a")));
    expect(first.filter(Boolean)).toHaveLength(2);

    const more = await Promise.all([
      reserveJevCall(env, "b"),
      reserveJevCall(env, "c"),
      reserveJevCall(env, "d"),
    ]);

    expect(more.filter(Boolean)).toHaveLength(2);
    expect(await reserveJevCall(env, "fresh-host")).toBe(false);
    vi.setSystemTime(new Date("2026-09-19T00:00:00Z"));
    expect(await reserveJevCall(env, "a")).toBe(true);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM jev_usage WHERE day < '2026-09-19'").get()?.count,
    ).toBe(0);
    env.JEV_DAILY_CALL_LIMIT = "0";
    expect(await reserveJevCall(env, "b")).toBe(false);
    env.JEV_DAILY_CALL_LIMIT = "invalid";
    expect(await reserveJevCall(env, "b")).toBe(false);
  } finally {
    db.close();
  }
});

it("allows exactly one sponsored Jev match per account", async () => {
  const db = migratedDb();
  db.prepare("INSERT INTO users (id, email) VALUES (?, ?)").run("host", "host@example.test");

  const env = testEnv({
    DB: new SQLiteD1(db),
  });

  try {
    expect(await hasSponsoredJevTrial(env, "host")).toBe(true);

    const claims = await Promise.all([
      claimSponsoredJevTrial(env, "host"),
      claimSponsoredJevTrial(env, "host"),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(await hasSponsoredJevTrial(env, "host")).toBe(false);
  } finally {
    db.close();
  }
});
