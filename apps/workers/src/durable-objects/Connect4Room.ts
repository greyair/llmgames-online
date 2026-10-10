import { isWireObject, type WireValue } from "@llmgames/game-catalog";

import type { RoomRuntime } from "./runtime";
import { isNumber } from "@llmgames/game-catalog";

import { ROOM_LIFETIME_MS } from "@llmgames/game-catalog";
import { BaseGameRoom } from "./BaseGameRoom";
import type { Env } from "../types";
import type { Connect4Cell, Connect4GameState, Player } from "./types";
import { randomId } from "../lib/csprng";

const ROWS = 6;

const COLS = 7;

function emptyBoard(): Connect4Cell[][] {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, (): Connect4Cell => 0));
}

function dropInColumn(board: Connect4Cell[][], col: number, seat: 1 | 2): number | null {
  if (col < 0 || col >= COLS) return null;

  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r]![col] === 0) {
      board[r]![col] = seat;

      return r;
    }
  }

  return null;
}

function checkWin(board: Connect4Cell[][], row: number, col: number): boolean {
  const seat = board[row]![col];

  if (!seat) return false;

  const dirs: Array<[number, number]> = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  for (const [dr, dc] of dirs) {
    let count = 1;

    for (const sign of [1, -1]) {
      let r = row + dr * sign;
      let c = col + dc * sign;

      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r]![c] === seat) {
        count++;
        r += dr * sign;
        c += dc * sign;
      }
    }

    if (count >= 4) return true;
  }

  return false;
}

function isBoardFull(board: Connect4Cell[][]): boolean {
  return board[0]!.every((c) => c !== 0);
}

/**
 * Server-authoritative Connect 4 (1v1).
 * Actions: drop_disc { col: 0-6 }
 */
export class Connect4Room extends BaseGameRoom<Connect4GameState> {
  protected readonly roomLabel = "Connect4Room";

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
  ): Connect4GameState {
    const createdAt = Date.now();

    return {
      id: randomId(),
      roomCode,
      type: "connect4",
      status: "waiting",
      players: [{ id: config.hostId, name: config.hostName }],
      hostId: config.hostId,
      maxPlayers: 2,
      timerConfig: {
        gameTotalTime: config.gameTotalTime ?? 15 * 60 * 1000,
        turnTime: config.turnTime ?? 60 * 1000,
      },
      gameTimeRemaining: config.gameTotalTime ?? 15 * 60 * 1000,
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
      board: emptyBoard(),
      seats: {},
      winner: null,
      lastMove: null,
    };
  }

  protected onStartGame(): void {
    if (!this.gameState) return;
    const players = this.gameState.players;
    // Random first player with CSPRNG
    const firstIdx = this.startingPlayerIndex();

    const order = [players[firstIdx]!, players[(firstIdx + 1) % players.length]!];

    this.gameState.seats = {
      [order[0]!.id]: 1,
      [order[1]!.id]: 2,
    };
    this.gameState.board = emptyBoard();
    this.gameState.winner = null;
    this.gameState.lastMove = null;
    this.gameState.turnState.currentPlayerId = order[0]!.id;
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
      this.gameState.turnState.phase === "play"
    ) {
      actions.push("drop_disc");
    }

    return actions;
  }

  protected buildYouContext(playerId: string) {
    const base = super.buildYouContext(playerId);

    if (base.isSpectator) {
      return { ...base, seat: null, role: "spectator" };
    }

    const seat = this.gameState?.seats[playerId] ?? null;

    return {
      ...base,
      seat,
      role: seat === 1 ? "player1" : seat === 2 ? "player2" : null,
    };
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (!this.gameState) return "No game state";

    if (payload.actionType === "drop_disc" || payload.actionType === "drop") {
      return this.handleDrop(player, payload.data);
    }

    return `Unknown action: ${payload.actionType}`;
  }

  private handleDrop(player: Player, data: WireValue): string | void {
    if (!this.gameState || this.gameState.status !== "playing") {
      return "Game is not playing";
    }

    if (this.gameState.turnState.currentPlayerId !== player.id) {
      return "Not your turn";
    }

    if (this.gameState.turnState.phase !== "play") {
      return "Not play phase";
    }

    const col = isWireObject(data) ? (data.col ?? data.column) : undefined;

    if (!isNumber(col) || !Number.isInteger(col) || col < 0 || col >= COLS) {
      return `Column must be integer 0–${COLS - 1}`;
    }

    const seat = this.gameState.seats[player.id];

    if (!seat) return "No seat assigned";

    const row = dropInColumn(this.gameState.board, col, seat);

    if (row === null) return "Column is full";

    this.gameState.lastMove = { col, row, seat };

    this.recordEvent("drop_disc", {
      playerId: player.id,
      seat,
      col,
      row,
    });

    if (checkWin(this.gameState.board, row, col)) {
      this.gameState.winner = player.id;
      this.gameState.status = "ended";
      this.gameState.turnState.phase = "ended";
      this.stopTimers();
      this.recordEvent("game_ended", {
        reason: "connect4",
        winner: player.id,
      });
      void this.saveState().then(() => {
        this.broadcastProjected("game_ended", { reason: "connect4" });
      });

      return;
    }

    if (isBoardFull(this.gameState.board)) {
      this.gameState.winner = "draw";
      this.gameState.status = "ended";
      this.gameState.turnState.phase = "ended";
      this.stopTimers();
      this.recordEvent("game_ended", { reason: "draw", winner: "draw" });
      void this.saveState().then(() => {
        this.broadcastProjected("game_ended", { reason: "draw" });
      });

      return;
    }

    // Next player
    const next = this.gameState.players.find((p) => p.id !== player.id);
    this.gameState.turnState.currentPlayerId = next?.id ?? null;
    this.gameState.turnState.turnNumber++;
    this.gameState.turnState.turnTimeRemaining = this.gameState.timerConfig.turnTime;
    this.gameState.turnState.startedAt = Date.now();
    this.recordEvent("turn_changed", {
      currentPlayerId: this.gameState.turnState.currentPlayerId,
      turnNumber: this.gameState.turnState.turnNumber,
      phase: "play",
    });
  }
}
