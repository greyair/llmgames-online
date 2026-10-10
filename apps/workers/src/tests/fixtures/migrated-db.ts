import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL } from "node:url";
import { SQLiteD1 } from "./sqlite-d1";

let migrationSql: string | undefined;

/** Applies the production migrations to a fresh in-memory SQLite database. */
export function migratedDb() {
  if (migrationSql === undefined) {
    const directory = new URL("../../../migrations/", import.meta.url);

    const filenames = readdirSync(directory)
      .filter((name) => name.endsWith(".sql"))
      .sort();

    migrationSql = filenames
      .map((filename) => readFileSync(new URL(filename, directory), "utf8"))
      .join("\n");
  }

  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migrationSql);

  return new SQLiteD1(sqlite);
}
