import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { URL } from "node:url";
import { expect, it } from "vitest";

it("migrates populated storage without changing current history or ranked totals", () => {
  const db = new DatabaseSync(":memory:");
  const directory = new URL("../../../migrations/", import.meta.url);

  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  try {
    for (const file of files.filter((file) => file < "0043_storage_cleanup.sql")) {
      db.exec(readFileSync(new URL(file, directory), "utf8"));
    }

    db.exec(`
      INSERT INTO users (id, email, gamertag, broadcast_allowed)
        VALUES ('a', 'a@example.test', 'Alpha', 1), ('b', 'b@example.test', 'Beta', 0);
      INSERT INTO games (id, game_type) VALUES ('legacy', 'reversi');
      INSERT INTO game_participants (game_id, user_id) VALUES ('legacy', 'a');
      INSERT INTO game_logs (id, game_type, started_at, ended_at, end_reason, event_count, r2_key, size_bytes)
        VALUES ('current', 'reversi', 1, 2, 'win', 1, 'current.gz', 100);
      INSERT INTO broadcast_rooms (id, room_id, game_type, created_at, listed_at, expires_at,
        summary, host_owner_user_id, broadcast_allowed)
        VALUES ('broadcast', 'room', 'reversi', 1, 1, 9999999999999, '{}', 'a', 1);
      INSERT INTO jev_trial_games (owner_id, room_id, claimed_at) VALUES ('a', 'room', 1);
      INSERT INTO ranked_blackjack_matches (room_id, player_a_owner_id, player_a_gamertag,
        player_a_bankroll, player_b_owner_id, player_b_gamertag, player_b_bankroll, result, ended_at)
        VALUES ('match-1', 'a', 'Alpha', 1200, 'b', 'Beta', 800, 'a', 1);
    `);
    db.exec(readFileSync(new URL("0043_storage_cleanup.sql", directory), "utf8"));

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);

    expect(tables).not.toContain("games");
    expect(tables).not.toContain("game_participants");
    expect(tables).not.toContain("broadcast_finished");
    expect(db.prepare("SELECT id FROM game_logs").all()).toEqual([{ id: "current" }]);
    expect(db.prepare("SELECT id FROM eligible_broadcast_rooms").all()).toEqual([
      { id: "broadcast" },
    ]);
    expect(db.prepare("SELECT owner_id FROM jev_trial_games").all()).toEqual([{ owner_id: "a" }]);
    expect(
      db
        .prepare(
          "SELECT owner_user_id, points, bankroll_delta FROM ranked_blackjack_stats ORDER BY owner_user_id",
        )
        .all(),
    ).toEqual([
      { owner_user_id: "a", points: 3, bankroll_delta: 200 },
      { owner_user_id: "b", points: 0, bankroll_delta: -200 },
    ]);
    db.exec(
      "INSERT INTO ranked_blackjack_matches (room_id, player_a_owner_id, player_a_bankroll, player_b_owner_id, player_b_bankroll, result, ended_at) VALUES ('match-2', 'a', 1000, 'b', 1000, 'draw', 2)",
    );
    expect(
      db.prepare("SELECT points FROM ranked_blackjack_stats WHERE owner_user_id = 'a'").get()
        ?.points,
    ).toBe(4);
    db.exec(readFileSync(new URL("0044_index_cleanup.sql", directory), "utf8"));
    expect(db.prepare("SELECT id FROM game_logs WHERE id = 'current'").get()).toEqual({
      id: "current",
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});

it("retires Blackjack rooms and ranked tables while preserving other games and history", () => {
  const db = new DatabaseSync(":memory:");
  const directory = new URL("../../../migrations/", import.meta.url);

  try {
    for (const file of readdirSync(directory)
      .filter((file) => file.endsWith(".sql") && file < "0046_remove_blackjack.sql")
      .sort()) {
      db.exec(readFileSync(new URL(file, directory), "utf8"));
    }

    db.exec(`
      INSERT INTO users (id, email) VALUES ('a', 'a@example.test'), ('b', 'b@example.test');
      INSERT INTO ranked_blackjack_matches (room_id, player_a_owner_id, player_a_bankroll, player_b_owner_id, player_b_bankroll, result, ended_at)
        VALUES ('match', 'a', 1200, 'b', 800, 'a', 1);
      INSERT INTO active_rooms (room_code, game_type, room_id, expires_at, created_at) VALUES
        ('AB2345', 'blackjack', 'blackjack-AB2345', 9999999999999, 1),
        ('BC2345', 'blackjack-duel', 'blackjack-duel-BC2345', 9999999999999, 1),
        ('CD2345', 'poker', 'poker-CD2345', 9999999999999, 1);
      INSERT INTO broadcast_rooms (id, room_id, game_type, created_at, listed_at, expires_at, summary) VALUES
        ('retired', 'blackjack-AB2345', 'blackjack', 1, 1, 9999999999999, '{}'),
        ('retained', 'poker-CD2345', 'poker', 1, 1, 9999999999999, '{}');
      INSERT INTO game_logs (id, game_type, started_at, ended_at, end_reason, event_count, r2_key, size_bytes)
        VALUES ('history', 'blackjack', 1, 2, 'win', 1, 'history.gz', 100);
    `);
    db.exec(readFileSync(new URL("0046_remove_blackjack.sql", directory), "utf8"));
    expect(db.prepare("SELECT game_type FROM active_rooms").all()).toEqual([
      { game_type: "poker" },
    ]);
    expect(db.prepare("SELECT id FROM broadcast_rooms").all()).toEqual([{ id: "retained" }]);
    expect(db.prepare("SELECT id FROM game_logs").all()).toEqual([{ id: "history" }]);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%ranked_blackjack%'").all(),
    ).toEqual([]);

    for (const game of ["blackjack", "blackjack-duel"]) {
      expect(() =>
        db
          .prepare(
            "INSERT INTO active_rooms (room_code, game_type, room_id, expires_at, created_at) VALUES ('DE2345', ?, 'retired', 9, 1)",
          )
          .run(game),
      ).toThrow();
    }

    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe("ok");
  } finally {
    db.close();
  }
});
