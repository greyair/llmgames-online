import { isWireObject, type WireValue } from "@llmgames/game-catalog";

import type { RoomRuntime } from "./runtime";
import { isNumber } from "@llmgames/game-catalog";

import { ROOM_LIFETIME_MS } from "@llmgames/game-catalog";
import { BaseGameRoom } from "./BaseGameRoom";
import type { Env } from "../types";
import type { Player, ReversiCell, ReversiGameState, ReversiMove } from "./types";
import { randomId } from "../lib/csprng";

export const REVERSI_SIZE = 8;

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];

export function createInitialReversiBoard(): ReversiCell[][] {
  const board = Array.from({ length: REVERSI_SIZE }, () =>
    Array.from({ length: REVERSI_SIZE }, (): ReversiCell => 0),
  );

  board[3]![3] = 2;
  board[3]![4] = 1;
  board[4]![3] = 1;
  board[4]![4] = 2;

  return board;
}

function isOnBoard(row: number, col: number): boolean {
  return row >= 0 && row < REVERSI_SIZE && col >= 0 && col < REVERSI_SIZE;
}

export function getReversiFlips(
  board: ReversiCell[][],
  row: number,
  col: number,
  seat: 1 | 2,
): Array<{ row: number; col: number }> {
  if (!isOnBoard(row, col) || board[row]?.[col] !== 0) return [];

  const opponent: 1 | 2 = seat === 1 ? 2 : 1;
  const flips: Array<{ row: number; col: number }> = [];

  for (const [dr, dc] of DIRECTIONS) {
    const line: Array<{ row: number; col: number }> = [];
    let r = row + dr;
    let c = col + dc;

    while (isOnBoard(r, c) && board[r]?.[c] === opponent) {
      line.push({ row: r, col: c });
      r += dr;
      c += dc;
    }

    if (line.length > 0 && isOnBoard(r, c) && board[r]?.[c] === seat) {
      flips.push(...line);
    }
  }

  return flips;
}

export function getReversiLegalMoves(board: ReversiCell[][], seat: 1 | 2): ReversiMove[] {
  const moves: ReversiMove[] = [];

  for (let row = 0; row < REVERSI_SIZE; row++) {
    for (let col = 0; col < REVERSI_SIZE; col++) {
      const flipCount = getReversiFlips(board, row, col, seat).length;

      if (flipCount > 0) moves.push({ row, col, flipCount });
    }
  }

  return moves;
}

export function applyReversiMove(
  board: ReversiCell[][],
  row: number,
  col: number,
  seat: 1 | 2,
): Array<{ row: number; col: number }> {
  const flips = getReversiFlips(board, row, col, seat);

  if (flips.length === 0) return [];
  board[row]![col] = seat;

  for (const cell of flips) board[cell.row]![cell.col] = seat;

  return flips;
}

export function countReversiDiscs(board: ReversiCell[][]): Record<1 | 2, number> {
  const scores: Record<1 | 2, number> = { 1: 0, 2: 0 };

  for (const row of board) {
    for (const cell of row) {
      if (cell === 1 || cell === 2) scores[cell]++;
    }
  }

  return scores;
}

/** Server-authoritative Reversi. Action: place_disc { row, col }. */
export class ReversiRoom extends BaseGameRoom<ReversiGameState> {
  protected readonly roomLabel = "ReversiRoom";

  constructor(state: RoomRuntime, env: Env) {
    super(state, env);
  }

  protected get minPlayersToStart(): number {
    return 2;
  }

  protected get initialTurnPhase(): string {
    return "play";
  }

  protected createDefaultState(
    config: {
      hostId: string;
      hostName: string;
      maxPlayers?: number;
      gameTotalTime?: number;
      turnTime?: number;
      roomCode?: string;
    },
    roomCode: string,
  ): ReversiGameState {
    const board = createInitialReversiBoard();
    const createdAt = Date.now();

    return {
      id: randomId(),
      roomCode,
      type: "reversi",
      status: "waiting",
      players: [{ id: config.hostId, name: config.hostName }],
      hostId: config.hostId,
      maxPlayers: 2,
      timerConfig: {
        gameTotalTime: config.gameTotalTime ?? 20 * 60 * 1000,
        turnTime: config.turnTime ?? 60 * 1000,
      },
      gameTimeRemaining: config.gameTotalTime ?? 20 * 60 * 1000,
      turnState: {
        currentPlayerId: null,
        turnNumber: 0,
        phase: "waiting",
        startedAt: 0,
        turnTimeRemaining: config.turnTime ?? 60 * 1000,
      },
      createdAt,
      updatedAt: createdAt,
      expiresAt: createdAt + ROOM_LIFETIME_MS,
      board,
      seats: {},
      winner: null,
      scores: countReversiDiscs(board),
      legalMoves: [],
      lastMove: null,
      lastPass: null,
    };
  }

  protected onStartGame(): void {
    if (!this.gameState) return;
    const players = this.gameState.players;
    const firstIdx = this.startingPlayerIndex();
    const black = players[firstIdx]!;
    const white = players[(firstIdx + 1) % players.length]!;
    const board = createInitialReversiBoard();

    this.gameState.seats = { [black.id]: 1, [white.id]: 2 };
    this.gameState.board = board;
    this.gameState.winner = null;
    this.gameState.scores = countReversiDiscs(board);
    this.gameState.legalMoves = getReversiLegalMoves(board, 1);
    this.gameState.lastMove = null;
    this.gameState.lastPass = null;
    this.gameState.turnState.currentPlayerId = black.id;
    this.gameState.turnState.phase = "play";
    this.gameState.turnState.turnNumber = 1;
  }

  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId);

    if (!this.gameState) return actions;

    if (this.isSpectator(playerId)) return actions;

    if (
      this.gameState.status === "playing" &&
      this.gameState.turnState.currentPlayerId === playerId &&
      this.gameState.legalMoves.length > 0
    ) {
      actions.push("place_disc");
    }

    return actions;
  }

  protected buildYouContext(playerId: string) {
    const base = super.buildYouContext(playerId);

    if (base.isSpectator) return { ...base, seat: null, role: "spectator" };
    const seat = this.gameState?.seats[playerId] ?? null;

    return {
      ...base,
      seat,
      color: seat === 1 ? "black" : seat === 2 ? "white" : null,
      role: seat === 1 ? "black" : seat === 2 ? "white" : null,
    };
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (!this.gameState) return "No game state";

    if (["place_disc", "place", "move"].includes(payload.actionType)) {
      return this.handlePlace(player, payload.data);
    }

    return `Unknown action: ${payload.actionType}`;
  }

  private handlePlace(player: Player, data: WireValue): string | void {
    if (!this.gameState || this.gameState.status !== "playing") {
      return "Game is not playing";
    }

    if (this.gameState.turnState.currentPlayerId !== player.id) {
      return "Not your turn";
    }

    const raw = isWireObject(data) ? data : null;
    const { row, col } = raw ?? {};

    if (
      !isNumber(row) ||
      !isNumber(col) ||
      !Number.isInteger(row) ||
      !Number.isInteger(col) ||
      !isOnBoard(row, col)
    ) {
      return "Row and col must be integers 0–7";
    }

    const seat = this.gameState.seats[player.id];

    if (!seat) return "No seat assigned";

    const flips = applyReversiMove(this.gameState.board, row, col, seat);

    if (flips.length === 0) return "Illegal move: placement must bracket opponent discs";

    this.gameState.lastMove = { playerId: player.id, row, col, seat, flipped: flips };
    this.gameState.lastPass = null;
    this.gameState.scores = countReversiDiscs(this.gameState.board);
    this.recordEvent("place_disc", {
      playerId: player.id,
      seat,
      row,
      col,
      flipped: flips.length,
    });

    this.advanceAfterMove(player.id, seat);
  }

  private advanceAfterMove(playerId: string, seat: 1 | 2): void {
    if (!this.gameState) return;
    const opponentSeat: 1 | 2 = seat === 1 ? 2 : 1;

    const opponent = this.gameState.players.find(
      (candidate) => this.gameState?.seats[candidate.id] === opponentSeat,
    );

    const opponentMoves = getReversiLegalMoves(this.gameState.board, opponentSeat);

    this.gameState.turnState.turnNumber++;
    this.resetTurnTimer();

    if (opponent && opponentMoves.length > 0) {
      this.gameState.turnState.currentPlayerId = opponent.id;
      this.gameState.legalMoves = opponentMoves;
      this.recordTurnChanged();

      return;
    }

    const currentMoves = getReversiLegalMoves(this.gameState.board, seat);

    if (currentMoves.length > 0) {
      if (opponent) {
        this.gameState.lastPass = {
          playerId: opponent.id,
          seat: opponentSeat,
          turn: this.gameState.turnState.turnNumber,
        };
        this.recordEvent("turn_passed", {
          playerId: opponent.id,
          seat: opponentSeat,
          reason: "no_legal_moves",
        });
      }

      this.gameState.turnState.currentPlayerId = playerId;
      this.gameState.legalMoves = currentMoves;
      this.recordTurnChanged();

      return;
    }

    this.finishByScore("no_legal_moves");
    void this.saveState().then(() => {
      this.broadcastProjected("game_ended", { reason: "no_legal_moves" });
    });
  }

  protected async onTurnTimeout(playerId: string | null): Promise<void> {
    if (!this.gameState || this.gameState.status !== "playing" || !playerId) return;
    const seat = this.gameState.seats[playerId];

    if (!seat) return;

    const opponentSeat: 1 | 2 = seat === 1 ? 2 : 1;

    const opponent = this.gameState.players.find(
      (candidate) => this.gameState?.seats[candidate.id] === opponentSeat,
    );

    const opponentMoves = getReversiLegalMoves(this.gameState.board, opponentSeat);

    this.gameState.turnState.turnNumber++;
    this.resetTurnTimer();

    if (opponent && opponentMoves.length > 0) {
      this.gameState.turnState.currentPlayerId = opponent.id;
      this.gameState.legalMoves = opponentMoves;
      this.recordTurnChanged();
      await this.saveState();

      return;
    }

    const currentMoves = getReversiLegalMoves(this.gameState.board, seat);

    if (currentMoves.length > 0) {
      this.gameState.turnState.currentPlayerId = playerId;
      this.gameState.legalMoves = currentMoves;
      this.recordTurnChanged();
      await this.saveState();

      return;
    }

    this.finishByScore("no_legal_moves");
    await this.saveState();
    this.broadcastProjected("game_ended", { reason: "no_legal_moves" });
  }

  protected onGameTimeout(): void {
    if (!this.gameState) return;
    this.setWinnerFromScores();
    this.gameState.turnState.phase = "ended";
    this.gameState.turnState.currentPlayerId = null;
    this.gameState.legalMoves = [];
  }

  private resetTurnTimer(): void {
    if (!this.gameState) return;
    this.gameState.turnState.turnTimeRemaining = this.gameState.timerConfig.turnTime;
    this.gameState.turnState.startedAt = Date.now();
  }

  private recordTurnChanged(): void {
    if (!this.gameState) return;
    this.recordEvent("turn_changed", {
      currentPlayerId: this.gameState.turnState.currentPlayerId,
      turnNumber: this.gameState.turnState.turnNumber,
      phase: "play",
    });
  }

  private setWinnerFromScores(): void {
    if (!this.gameState) return;
    this.gameState.scores = countReversiDiscs(this.gameState.board);

    if (this.gameState.scores[1] === this.gameState.scores[2]) {
      this.gameState.winner = "draw";

      return;
    }

    const winningSeat: 1 | 2 = this.gameState.scores[1] > this.gameState.scores[2] ? 1 : 2;

    this.gameState.winner =
      this.gameState.players.find((player) => this.gameState?.seats[player.id] === winningSeat)
        ?.id ?? "draw";
  }

  private finishByScore(reason: string): void {
    if (!this.gameState) return;
    this.setWinnerFromScores();
    this.gameState.status = "ended";
    this.gameState.turnState.phase = "ended";
    this.gameState.turnState.currentPlayerId = null;
    this.gameState.legalMoves = [];
    this.stopTimers();
    this.recordEvent("game_ended", {
      reason,
      winner: this.gameState.winner,
      scores: this.gameState.scores,
    });
  }
}
