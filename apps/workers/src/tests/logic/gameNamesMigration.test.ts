import { URL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";

it("migrates game metadata and clears retired live rooms for the new version", () => {
  const db = new DatabaseSync(":memory:");
  const directory = new URL("../../../migrations/", import.meta.url);

  try {
    for (const file of readdirSync(directory)
      .filter((file) => file.endsWith(".sql") && file < "0045")
      .sort()) {
      db.exec(readFileSync(new URL(file, directory), "utf8"));
    }

    const games = [
      ["four-in-a-row", "connect4"],
      ["find-my-ship", "battleship"],
      ["semantic-race", "contexto"],
    ];

    for (const [old] of games) {
      db.prepare("INSERT INTO active_rooms VALUES (?, ?, ?, 'active', 9000, 1000)").run(
        old!,
        old!,
        `${old}-ABC234`,
      );
      db.prepare(
        "INSERT INTO game_logs (id,game_type,started_at,ended_at,end_reason,event_count,r2_key,size_bytes) VALUES (?, ?, 1, 2, 'win', 1, ?, 10)",
      ).run(old!, old!, `${old}.gz`);
      db.prepare(
        "INSERT INTO broadcast_rooms (id,room_id,game_type,created_at,listed_at,expires_at,summary,snapshot) VALUES (?, ?, ?, 1, 1, 9000, ?, ?)",
      ).run(
        old!,
        `${old}-ABC234`,
        old!,
        JSON.stringify({ type: old, status: "playing" }),
        JSON.stringify({ type: old, players: [] }),
      );
    }

    db.exec(readFileSync(new URL("0045_original_game_names.sql", directory), "utf8"));

    for (const [old, current] of games) {
      expect(
        db.prepare("SELECT game_type, room_id FROM active_rooms WHERE room_code = ?").get(old!),
      ).toBeUndefined();
      expect(db.prepare("SELECT game_type, r2_key FROM game_logs WHERE id = ?").get(old!)).toEqual({
        game_type: current,
        r2_key: `${old}.gz`,
      });

      const broadcast = db
        .prepare("SELECT summary, snapshot FROM broadcast_rooms WHERE id = ?")
        .get(old!)!;

      expect(JSON.parse(String(broadcast.summary))).toEqual({ type: current, status: "playing" });
      expect(JSON.parse(String(broadcast.snapshot))).toEqual({ type: current, players: [] });
      db.prepare("INSERT INTO active_rooms VALUES (?, ?, ?, 'active', 9000, 1000)").run(
        current!,
        current!,
        `${current}-DEF234`,
      );
    }

    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  } finally {
    db.close();
  }
});
