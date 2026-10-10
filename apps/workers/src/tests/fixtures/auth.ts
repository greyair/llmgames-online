import { URL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { z } from "zod";
import type { User } from "../../types";
import { SQLiteD1 } from "./sqlite-d1";

export function testDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  const directory = new URL("../../../migrations/", import.meta.url);

  for (const file of readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(new URL(file, directory), "utf8"));

  return { sqlite, db: new SQLiteD1(sqlite) };
}

export function testUser(overrides: Partial<User> = {}): User {
  return {
    id: "owner",
    email: "owner@example.test",
    name: null,
    gamertag: null,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  gamertag: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
  gamertag_selected: z.number().optional(),
  broadcast_allowed: z.number().optional(),
});
