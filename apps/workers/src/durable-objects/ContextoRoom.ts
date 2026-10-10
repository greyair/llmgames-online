import { isWireObject, type WireValue } from "@llmgames/game-catalog";

import type { RoomRuntime } from "./runtime";
import { isString } from "@llmgames/game-catalog";

import { ROOM_LIFETIME_MS } from "@llmgames/game-catalog";
import type { Env } from "../types";
import { randomId, randomInt } from "../lib/csprng";
import {
  createContextoRanking,
  normalizeContextoWord,
  contextoGuessFamily,
  contextoRank,
  contextoTarget,
  CONTEXTO_TARGET_COUNT,
  CONTEXTO_VOCABULARY_SIZE,
} from "../lib/contextoRanks";
import { BaseGameRoom } from "./BaseGameRoom";
import type {
  GameRoomConfig,
  Player,
  ContextoPlayerProgress,
  ContextoGameState,
  ContextoGuess,
} from "./types";

const GUESS_LIMIT = 50 as const;

function emptyProgress(playerId: string): ContextoPlayerProgress {
  return { playerId, guesses: [], lastAttempt: null, bestRank: null, exhausted: false };
}

export class ContextoRoom extends BaseGameRoom<ContextoGameState> {
  protected readonly roomLabel = "ContextoRoom";

  constructor(state: RoomRuntime, env: Env) {
    super(state, env);
  }

  protected get minPlayersToStart(): number {
    return 1;
  }

  protected get initialTurnPhase(): string {
    return "guessing";
  }

  protected createDefaultState(config: GameRoomConfig, roomCode: string): ContextoGameState {
    const createdAt = Date.now();
    const gameTotalTime = config.gameTotalTime ?? 15 * 60 * 1000;

    return {
      id: randomId(),
      roomCode,
      type: "contexto",
      status: "waiting",
      players: [{ id: config.hostId, name: config.hostName }],
      hostId: config.hostId,
      maxPlayers: Math.min(6, Math.max(1, config.maxPlayers ?? 6)),
      timerConfig: { gameTotalTime, turnTime: gameTotalTime },
      gameTimeRemaining: gameTotalTime,
      turnState: {
        currentPlayerId: null,
        turnNumber: 0,
        phase: "waiting",
        startedAt: 0,
        turnTimeRemaining: gameTotalTime,
      },
      createdAt,
      updatedAt: createdAt,
      expiresAt: createdAt + ROOM_LIFETIME_MS,
      secret: contextoTarget(0)!,
      rankTable: "",
      guessLimit: GUESS_LIMIT,
      vocabularySize: CONTEXTO_VOCABULARY_SIZE,
      progress: {},
      winner: null,
      totalGuesses: 0,
    };
  }

  protected onStartGame(): void {
    if (!this.gameState) return;
    this.gameState.secret = contextoTarget(randomInt(CONTEXTO_TARGET_COUNT))!;
    this.gameState.rankTable = createContextoRanking(this.gameState.secret)!;
    this.gameState.progress = Object.fromEntries(
      this.gameState.players.map((player) => [player.id, emptyProgress(player.id)]),
    );
    this.gameState.winner = null;
    this.gameState.totalGuesses = 0;
    this.gameState.turnState.currentPlayerId = null;
    this.gameState.turnState.phase = "guessing";
    this.gameState.turnState.turnTimeRemaining = this.gameState.gameTimeRemaining;
  }

  protected isYourTurn(playerId: string): boolean {
    const progress = this.gameState?.progress[playerId];

    return (
      this.gameState?.status === "playing" &&
      !this.isSpectator(playerId) &&
      Boolean(progress && !progress.exhausted && progress.guesses.length < GUESS_LIMIT)
    );
  }

  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId);
    const progress = this.gameState?.progress[playerId];

    if (
      this.gameState?.status === "playing" &&
      !this.isSpectator(playerId) &&
      progress &&
      !progress.exhausted
    ) {
      actions.push("guess_word");
    }

    return actions;
  }

  protected buildYouContext(playerId: string) {
    const base = super.buildYouContext(playerId);

    return {
      ...base,
      isYourTurn:
        this.gameState?.status === "playing" &&
        !base.isSpectator &&
        !this.gameState.progress[playerId]?.exhausted,
    };
  }

  protected projectStateFor(playerId: string, state: ContextoGameState) {
    const { rankTable: _rankTable, ...visibleState } = state;
    const ended = state.status === "ended";
    // BaseGameRoom reserves the empty viewer ID for its authorized public
    // broadcast path. Real players and room spectators always keep words fogged.
    const publicBroadcast = playerId === "";

    const progress = Object.fromEntries(
      Object.entries(state.progress).map(([id, entry]) => {
        const own = id === playerId;

        const guesses =
          own || publicBroadcast
            ? entry.guesses
            : [...entry.guesses]
                .sort((a, b) => a.rank - b.rank || a.sequence - b.sequence)
                .map((guess) => ({ rank: guess.rank, masked: true }));

        return [
          id,
          {
            playerId: id,
            guesses,
            lastAttempt: own ? (entry.lastAttempt ?? null) : undefined,
            guessCount: entry.guesses.length,
            guessesRemaining: Math.max(0, GUESS_LIMIT - entry.guesses.length),
            bestRank: entry.bestRank,
            exhausted: entry.exhausted,
          },
        ];
      }),
    );

    return {
      ...visibleState,
      secret: ended ? state.secret : undefined,
      progress,
    };
  }

  protected buildRewatchView(): object | null {
    return this.gameState ? this.projectStateFor("", this.gameState) : null;
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (payload.actionType !== "guess_word" && payload.actionType !== "guess") {
      return `Unknown action: ${payload.actionType}`;
    }

    if (!this.gameState || this.gameState.status !== "playing") {
      return "Game is not playing";
    }

    const progress = this.gameState.progress[player.id];

    if (!progress) return "No player progress";

    if (progress.exhausted || progress.guesses.length >= GUESS_LIMIT) {
      return "You have used all 50 guesses";
    }

    const raw = isWireObject(payload.data) ? payload.data.word : undefined;

    if (!isString(raw)) return "Word is required";
    const submittedWord = normalizeContextoWord(raw);

    if (!submittedWord) return "Use one English word with letters only";
    const word = contextoGuessFamily(submittedWord);

    if (progress.guesses.some((guess) => guess.word === word)) {
      return "You already guessed that word or another form of it";
    }

    if (!this.gameState.rankTable) {
      this.gameState.rankTable = createContextoRanking(this.gameState.secret)!;
    }

    const rank = contextoRank(this.gameState.rankTable, word);

    if (rank === null) {
      progress.lastAttempt = { submittedWord, status: "not_in_pool" };
      this.gameState.updatedAt = Date.now();
      await this.saveState();
      this.broadcastState();

      return "That word is not in this game's dictionary";
    }

    this.gameState.totalGuesses++;
    const aliased = submittedWord !== word;
    progress.lastAttempt = {
      submittedWord,
      canonicalWord: word,
      status: aliased ? "aliased" : "ranked",
      rank,
    };
    const guess: ContextoGuess = { word, rank, sequence: this.gameState.totalGuesses };

    if (aliased) guess.submittedWord = submittedWord;
    progress.guesses.unshift(guess);
    progress.bestRank = progress.bestRank === null ? rank : Math.min(progress.bestRank, rank);
    progress.exhausted = progress.guesses.length >= GUESS_LIMIT;
    this.gameState.turnState.turnNumber = this.gameState.totalGuesses;
    this.recordEvent("guess_word", {
      playerId: player.id,
      rank,
      guessNumber: progress.guesses.length,
    });

    if (rank === 1) {
      await this.finish(player.id, "secret_found");

      return;
    }

    if (Object.values(this.gameState.progress).every((entry) => entry.exhausted)) {
      await this.finish(this.bestPlayer(), "guess_limit");
    }
  }

  protected onGameTimeout(): void {
    if (!this.gameState) return;
    this.gameState.winner = this.bestPlayer();
  }

  protected async onTurnTimeout(): Promise<void> {
    if (!this.gameState) return;
    this.gameState.turnState.turnTimeRemaining = this.gameState.gameTimeRemaining;
    this.gameState.turnState.startedAt = Date.now();
  }

  private bestPlayer(): string {
    if (!this.gameState) return "draw";

    const ranked = Object.values(this.gameState.progress)
      .filter((entry) => entry.bestRank !== null)
      .sort((a, b) => a.bestRank! - b.bestRank!);

    if (!ranked[0] || ranked[0].bestRank === ranked[1]?.bestRank) return "draw";

    return ranked[0].playerId;
  }

  private async finish(winner: string, reason: string): Promise<void> {
    if (!this.gameState) return;
    this.gameState.winner = winner;
    this.gameState.status = "ended";
    this.gameState.turnState.phase = "ended";
    this.gameState.turnState.currentPlayerId = null;
    this.stopTimers();
    this.recordEvent("game_ended", { reason, winner });
    await this.saveState();
    this.broadcastProjected("game_ended", { reason });
  }
}
