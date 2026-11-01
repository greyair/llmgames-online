import { describe, expect, it } from "vitest";

import { clientViewContract, clientViewSchema } from "../../../../web/src/domain/game-state";
import { createGameRoomFixture } from "../fixtures/game-room";
import { Connect4Room } from "../../durable-objects/Connect4Room";
import { ReversiRoom } from "../../durable-objects/ReversiRoom";
import { CheckersRoom } from "../../durable-objects/CheckersRoom";
import { BattleshipRoom } from "../../durable-objects/BattleshipRoom";
import { CodenamesGameRoom } from "../../durable-objects/CodenamesGameRoom";
import { ContextoRoom } from "../../durable-objects/ContextoRoom";
import { PokerRoom } from "../../durable-objects/PokerRoom";
import { PokemonRoom } from "../../durable-objects/PokemonRoom";
import { GomokuRoom } from "../../durable-objects/GomokuRoom";
import { AeroplaneRoom } from "../../durable-objects/AeroplaneRoom";
import { PaodekuaiRoom } from "../../durable-objects/PaodekuaiRoom";
import { DoudizhuRoom } from "../../durable-objects/DoudizhuRoom";
import { MonopolyRoom } from "../../durable-objects/MonopolyRoom";
import { ChessRoom } from "../../durable-objects/ChessRoom";
import { XiangqiRoom } from "../../durable-objects/XiangqiRoom";
import { GoRoom } from "../../durable-objects/GoRoom";

/**
 * The browser drops any frame `clientViewSchema` rejects, so a projection the
 * schema does not model is invisible in production: the room keeps rendering
 * the last accepted state, which is the lobby. Server-side tests cannot see
 * that, because nothing on the server reads the schema.
 *
 * This suite closes the gap by validating the exact payload `buildClientView`
 * hands a socket, for every seat of every game. Add the new game here when you
 * port one; the fixture already produces its real view.
 */
const rooms = [
  { game: "connect4", players: 2, open: () => createGameRoomFixture(Connect4Room, "connect4", 2) },
  { game: "reversi", players: 2, open: () => createGameRoomFixture(ReversiRoom, "reversi", 2) },
  { game: "checkers", players: 2, open: () => createGameRoomFixture(CheckersRoom, "checkers", 2) },
  {
    game: "battleship",
    players: 2,
    open: () => createGameRoomFixture(BattleshipRoom, "battleship", 2),
  },
  { game: "codenames", players: 4, open: () => createGameRoomFixture(CodenamesGameRoom, "codenames", 4) },
  { game: "contexto", players: 2, open: () => createGameRoomFixture(ContextoRoom, "contexto", 2) },
  { game: "poker", players: 2, open: () => createGameRoomFixture(PokerRoom, "poker", 2) },
  { game: "pokemon", players: 2, open: () => createGameRoomFixture(PokemonRoom, "pokemon", 2) },
  { game: "gomoku", players: 2, open: () => createGameRoomFixture(GomokuRoom, "gomoku", 2) },
  {
    game: "aeroplane",
    players: 2,
    role: /^seat\d$/,
    open: () => createGameRoomFixture(AeroplaneRoom, "aeroplane", 2),
  },
  {
    game: "paodekuai",
    players: 3,
    role: /^seat\d$/,
    open: () => createGameRoomFixture(PaodekuaiRoom, "paodekuai", 3),
  },
  {
    game: "doudizhu",
    players: 3,
    role: /^seat\d$/,
    open: () => createGameRoomFixture(DoudizhuRoom, "doudizhu", 3),
  },
  {
    game: "monopoly",
    players: 2,
    role: /^seat\d$/,
    open: () => createGameRoomFixture(MonopolyRoom, "monopoly", 2),
  },
  {
    game: "chess",
    players: 2,
    role: /^(white|black)$/,
    open: () => createGameRoomFixture(ChessRoom, "chess", 2),
  },
  {
    game: "xiangqi",
    players: 2,
    role: /^(red|black)$/,
    open: () => createGameRoomFixture(XiangqiRoom, "xiangqi", 2),
  },
  { game: "go", players: 2, open: () => createGameRoomFixture(GoRoom, "go", 2) },
];

/** Field-level detail, because the wrapper's `z.custom` error carries no path. */
type ContractIssue = { path: readonly PropertyKey[]; code: string };

function rejection(issues: readonly ContractIssue[]): string {
  const named = issues.map((issue) => `${issue.path.join(".") || "<root>"} (${issue.code})`);

  return named.length ? named.join(", ") : "no issues reported";
}

describe("every projected browser view matches the client schema", () => {
  for (const { game, open, role } of rooms) {
    it(`accepts ${game} for each seat`, async () => {
      const { room, ids } = await open();

      for (const id of ids) {
        const frame = await room.browser(id);
        const parsed = clientViewContract.safeParse(frame);
        const detail = parsed.success ? "accepted" : rejection(parsed.error.issues);

        expect(parsed.success, `${game} ${id}: ${detail}`).toBe(true);

        if (!parsed.success) continue;

        // The view has to carry the role that used to be rejected, otherwise
        // this test would pass on a lobby frame and prove nothing.
        if (role) expect(parsed.data.you?.role, `${game} ${id} role`).toMatch(role);
      }
    });
  }

  it("sends the chess board as a string and the xiangqi board as 90 cells", async () => {
    const chess = await createGameRoomFixture(ChessRoom, "chess-board", 2);
    const xiangqi = await createGameRoomFixture(XiangqiRoom, "xiangqi-board", 2);

    const chessView = clientViewContract.parse(await chess.room.browser(chess.ids[0]!));
    const xiangqiView = clientViewContract.parse(await xiangqi.room.browser(xiangqi.ids[0]!));

    expect(chessView.board).toHaveLength(64);
    expect(xiangqiView.board).toHaveLength(90);
  });
});

describe("the seat roles and boards the games send", () => {
  const base = {
    status: "playing",
    players: [{ id: "p1", name: "A" }],
    you: { playerId: "p1" },
  };

  it("accepts the seat-numbered and colour roles", () => {
    for (const role of ["seat0", "seat1", "seat2", "seat11", "red", "white", "spectator"])
      expect(clientViewSchema.safeParse({ ...base, you: { playerId: "p1", role } }).success).toBe(
        true,
      );
  });

  it("rejects a role no game sends", () => {
    for (const role of ["seat12", "seat", "reds", "admin"])
      expect(clientViewSchema.safeParse({ ...base, you: { playerId: "p1", role } }).success).toBe(
        false,
      );
  });

  it("accepts a 64-character chess board and a 90-cell xiangqi board", () => {
    const fen = "rnbqkbnrpppppppp................................PPPPPPPPRNBQKBNR";

    expect(clientViewSchema.safeParse({ ...base, board: fen }).success).toBe(true);
    expect(clientViewSchema.safeParse({ ...base, board: Array(90).fill(".") }).success).toBe(true);
  });

  it("rejects boards that are neither grid, word cards, chess nor xiangqi", () => {
    expect(clientViewSchema.safeParse({ ...base, board: "too short" }).success).toBe(false);
    expect(clientViewSchema.safeParse({ ...base, board: Array(89).fill(".") }).success).toBe(false);
  });
});
