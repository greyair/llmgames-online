import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { normalizeGameType, roomIdFor } from "../../lib/roomRouting";

describe("room game type routing", () => {
  it("accepts the original game names and rejects retired identifiers", () => {
    expect(normalizeGameType("connect4")).toBe("connect4");
    expect(normalizeGameType("battleship")).toBe("battleship");
    expect(normalizeGameType("checkers")).toBe("checkers");
    expect(normalizeGameType("draughts")).toBe("checkers");
    expect(normalizeGameType("codenames")).toBe("codenames");
    expect(normalizeGameType("semantic")).toBeNull();
    expect(normalizeGameType("contexto")).toBe("contexto");
    expect(normalizeGameType("connect-four")).toBeNull();
    expect(normalizeGameType("connect_four")).toBeNull();
    expect(normalizeGameType("four-in-a-row")).toBeNull();
    expect(normalizeGameType("Connect 4")).toBe("connect4");
    expect(normalizeGameType("find-my-ship")).toBeNull();
    expect(normalizeGameType("semantic-race")).toBeNull();
    expect(normalizeGameType("guess-the-word")).toBeNull();

    for (const game of ["blackjack", "blackjack-duel", "bj-duel", "blackjack_duel"])
      expect(normalizeGameType(game)).toBeNull();
    expect(normalizeGameType("unknown")).toBeNull();
  });
});

describe("roomIdFor", () => {
  it("builds canonical Durable Object names from game type and room code", () => {
    expect(roomIdFor("connect4", "abc234")).toBe("connect4-ABC234");
    expect(roomIdFor("poker", "xyz789")).toBe("poker-XYZ789");
    expect(roomIdFor("codenames", "abc234")).toBe("codenames-ABC234");
  });
});

describe("active room schema", () => {
  it("allows every routed game type in the shared room directory", () => {
    const schemaUrl = new URL("../../../schema.sql", import.meta.url);
    const schema = readFileSync(fileURLToPath(schemaUrl.href), "utf8");
    const db = new DatabaseSync(":memory:");
    db.exec(schema);

    const activeRooms = String(
      db.prepare("SELECT sql FROM sqlite_master WHERE name = 'active_rooms'").get()?.sql,
    );

    for (const gameType of [
      "connect4",
      "reversi",
      "checkers",
      "codenames",
      "battleship",
      "poker",
      "contexto",
    ]) {
      expect(activeRooms).toContain(`'${gameType}'`);
    }

    db.close();
  });
});
