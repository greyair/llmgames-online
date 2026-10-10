import { isWireObject, type WireValue } from "@llmgames/game-catalog";

import { isNumber } from "@llmgames/game-catalog";

import { ROOM_LIFETIME_MS } from "@llmgames/game-catalog";
import { BaseGameRoom } from "./BaseGameRoom";
import type { CheckersCell, CheckersGameState, CheckersMove, Player } from "./types";
import { randomId } from "../lib/csprng";

export function createInitialCheckersBoard(): CheckersCell[][] {
  return Array.from({ length: 8 }, (_, row) =>
    Array.from({ length: 8 }, (_, col) =>
      (row + col) % 2 === 0 ? 0 : row < 3 ? 2 : row > 4 ? 1 : 0,
    ),
  );
}

export function checkersSeat(piece: number): 0 | 1 | 2 {
  return piece === 1 || piece === 3 ? 1 : piece === 2 || piece === 4 ? 2 : 0;
}

export function countCheckersPieces(board: CheckersCell[][]): Record<1 | 2, number> {
  const scores = { 1: 0, 2: 0 };

  for (const row of board)
    for (const piece of row) {
      const seat = checkersSeat(piece);

      if (seat) scores[seat]++;
    }

  return scores;
}

/** Return one-step intents. A capture chain is locked to its current piece. */
export function getCheckersLegalMoves(
  board: CheckersCell[][],
  seat: 1 | 2,
  forcedPiece: {
    row: number;
    col: number;
  } | null = null,
): CheckersMove[] {
  const captures: CheckersMove[] = [],
    steps: CheckersMove[] = [];

  for (let fromRow = 0; fromRow < 8; fromRow++)
    for (let fromCol = 0; fromCol < 8; fromCol++) {
      const piece = board[fromRow]![fromCol]!;

      if (
        checkersSeat(piece) !== seat ||
        (forcedPiece && (forcedPiece.row !== fromRow || forcedPiece.col !== fromCol))
      )
        continue;

      for (const dr of piece > 2 ? [-1, 1] : [seat === 1 ? -1 : 1])
        for (const dc of [-1, 1]) {
          const row = fromRow + dr,
            col = fromCol + dc;

          if (board[row]?.[col] === 0 && !forcedPiece)
            steps.push({ fromRow, fromCol, row, col, capture: null });
          const other = checkersSeat(board[row]?.[col] ?? 0);

          if (other && other !== seat && board[row + dr]?.[col + dc] === 0)
            captures.push({
              fromRow,
              fromCol,
              row: row + dr,
              col: col + dc,
              capture: { row, col },
            });
        }
    }

  return captures.length ? captures : steps;
}

export class CheckersRoom extends BaseGameRoom<CheckersGameState> {
  protected readonly roomLabel = "CheckersRoom";
  protected get minPlayersToStart() {
    return 2;
  }
  protected get initialTurnPhase() {
    return "play";
  }
  protected createDefaultState(
    config: {
      hostId: string;
      hostName: string;
      gameTotalTime?: number;
      turnTime?: number;
    },
    roomCode: string,
  ): CheckersGameState {
    const now = Date.now(),
      board = createInitialCheckersBoard();

    return {
      id: randomId(),
      roomCode,
      type: "checkers",
      status: "waiting",
      players: [{ id: config.hostId, name: config.hostName }],
      hostId: config.hostId,
      maxPlayers: 2,
      timerConfig: {
        gameTotalTime: config.gameTotalTime ?? 1200000,
        turnTime: config.turnTime ?? 60000,
      },
      gameTimeRemaining: config.gameTotalTime ?? 1200000,
      turnState: {
        currentPlayerId: null,
        turnNumber: 0,
        phase: "waiting",
        startedAt: 0,
        turnTimeRemaining: config.turnTime ?? 60000,
      },
      createdAt: now,
      updatedAt: now,
      expiresAt: now + ROOM_LIFETIME_MS,
      board,
      seats: {},
      scores: countCheckersPieces(board),
      winner: null,
      legalMoves: [],
      forcedPiece: null,
      lastMove: null,
      quietTurns: 0,
      positionCounts: {},
    };
  }
  protected onStartGame(): void {
    const s = this.gameState!;

    const first = this.startingPlayerIndex(),
      black = s.players[first]!,
      white = s.players[1 - first]!;

    s.seats = { [black.id]: 1, [white.id]: 2 };
    s.board = createInitialCheckersBoard();
    s.scores = countCheckersPieces(s.board);
    s.winner = null;
    s.forcedPiece = null;
    s.lastMove = null;
    s.quietTurns = 0;
    s.turnState.currentPlayerId = black.id;
    s.turnState.phase = "play";
    s.turnState.turnNumber = 1;
    s.legalMoves = getCheckersLegalMoves(s.board, 1);
    s.positionCounts = { [this.positionKey(1)]: 1 };
  }
  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId),
      s = this.gameState;

    if (
      s?.status === "playing" &&
      !this.isSpectator(playerId) &&
      s.turnState.currentPlayerId === playerId &&
      s.legalMoves.length
    )
      actions.push("move_checker");

    return actions;
  }
  protected buildYouContext(playerId: string) {
    const base = super.buildYouContext(playerId),
      seat = base.isSpectator ? null : (this.gameState?.seats[playerId] ?? null);

    return { ...base, seat, color: seat === 1 ? "black" : seat === 2 ? "white" : null };
  }
  protected buildRewatchView(): object | null {
    return this.gameState ? this.projectStateFor("", this.gameState) : null;
  }
  protected projectStateFor(_playerId: string, state: CheckersGameState) {
    const { positionCounts: _positions, ...publicState } = state;

    return publicState;
  }
  protected async handleGameAction(
    player: Player,
    payload: {
      actionType: string;
      data: WireValue;
    },
  ): Promise<string | void> {
    const s = this.gameState;

    if (payload.actionType !== "move_checker") return `Unknown action: ${payload.actionType}`;

    if (!s || s.status !== "playing") return "Game is not playing";

    if (s.turnState.currentPlayerId !== player.id) return "Not your turn";
    const data = isWireObject(payload.data) ? payload.data : null;

    if (
      !data ||
      ![data.fromRow, data.fromCol, data.row, data.col].every(
        (n) => isNumber(n) && Number.isInteger(n) && n >= 0 && n < 8,
      )
    )
      return "Coordinates must be integers 0–7";
    const seat = s.seats[player.id]!;

    // Recompute against authoritative state; never trust a client-provided capture.
    const move = getCheckersLegalMoves(s.board, seat, s.forcedPiece).find(
      (m) =>
        m.fromRow === data.fromRow &&
        m.fromCol === data.fromCol &&
        m.row === data.row &&
        m.col === data.col,
    );

    if (!move)
      return "Illegal move. Captures are mandatory; finish a jump chain with the same piece.";
    const piece = s.board[move.fromRow]![move.fromCol]!;
    const crowned = piece <= 2 && move.row === (seat === 1 ? 0 : 7);
    s.board[move.fromRow]![move.fromCol] = 0;
    s.board[move.row]![move.col] = crowned ? (seat === 1 ? 3 : 4) : piece;

    if (move.capture) s.board[move.capture.row]![move.capture.col] = 0;
    s.scores = countCheckersPieces(s.board);
    s.lastMove = { ...move, playerId: player.id, crowned };
    s.quietTurns = move.capture || piece <= 2 ? 0 : s.quietTurns + 1;
    this.recordEvent("move_checker", { ...s.lastMove });

    if (move.capture && !crowned) {
      const forced = { row: move.row, col: move.col },
        next = getCheckersLegalMoves(s.board, seat, forced);

      if (next.length) {
        s.forcedPiece = forced;
        s.legalMoves = next;

        return;
      }
    }

    s.forcedPiece = null;
    const nextSeat = seat === 1 ? 2 : 1;
    s.legalMoves = getCheckersLegalMoves(s.board, nextSeat);

    if (!s.legalMoves.length) {
      this.finish(player.id, "no_legal_moves");
      await this.saveState();
      this.broadcastProjected("game_ended", { reason: "no_legal_moves" });

      return;
    }

    const key = this.positionKey(nextSeat);
    s.positionCounts[key] = (s.positionCounts[key] ?? 0) + 1;

    if (s.positionCounts[key] >= 3 || s.quietTurns >= 80) {
      const reason = s.quietTurns >= 80 ? "no_progress" : "repetition";
      this.finish("draw", reason);
      await this.saveState();
      this.broadcastProjected("game_ended", { reason });

      return;
    }

    s.turnState.currentPlayerId = s.players.find((p) => s.seats[p.id] === nextSeat)!.id;
    s.turnState.turnNumber++;
    s.turnState.startedAt = Date.now();
    s.turnState.turnTimeRemaining = s.timerConfig.turnTime;
    this.recordEvent("turn_changed", {
      currentPlayerId: s.turnState.currentPlayerId,
      turnNumber: s.turnState.turnNumber,
      phase: "play",
    });
  }
  private positionKey(seat: 1 | 2): string {
    return `${seat}:${this.gameState!.board.flat().join("")}`;
  }
  private finish(winner: string, reason: string): void {
    const s = this.gameState!;
    s.winner = winner;
    s.status = "ended";
    s.turnState.phase = "ended";
    s.turnState.currentPlayerId = null;
    s.legalMoves = [];
    s.forcedPiece = null;
    this.stopTimers();
    this.recordEvent("game_ended", { reason, winner, scores: s.scores });
  }
  protected async onTurnTimeout(playerId: string | null): Promise<void> {
    const s = this.gameState;

    if (!s || s.status !== "playing" || !playerId) return;
    this.finish(s.players.find((p) => p.id !== playerId)!.id, "turn_timeout");
    await this.saveState();
    this.broadcastProjected("game_ended", { reason: "turn_timeout" });
  }
  protected onGameTimeout(): void {
    const s = this.gameState;

    if (!s) return;
    s.winner = "draw";
    s.turnState.phase = "ended";
    s.turnState.currentPlayerId = null;
    s.legalMoves = [];
    s.forcedPiece = null;
  }
}
