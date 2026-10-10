import { isWireObject, type WireValue } from "@llmgames/game-catalog";

import type { RoomRuntime } from "./runtime";
import { isNumber, isString } from "@llmgames/game-catalog";

import { ROOM_LIFETIME_MS } from "@llmgames/game-catalog";
import type { Env } from "../types";
import { randomId, randomInt, shuffleInPlace } from "../lib/csprng";
import { CODENAMES_WORDS } from "../lib/codenamesWords";
import { BaseGameRoom } from "./BaseGameRoom";
import type {
  CodenamesAffiliation,
  CodenamesAssignment,
  CodenamesCard,
  CodenamesGameState,
  CodenamesLogEntry,
  CodenamesTeam,
  Player,
} from "./types";

const BOARD_SIZE = 25;

const MIN_PLAYERS = 4;

const MAX_PLAYERS = 8;

interface CodenamesAssignments {
  [playerId: string]: CodenamesAssignment;
}

export function otherCodenamesTeam(team: CodenamesTeam): CodenamesTeam {
  return team === "red" ? "blue" : "red";
}

export function createCodenamesAffiliations(startingTeam: CodenamesTeam): CodenamesAffiliation[] {
  const otherTeam = otherCodenamesTeam(startingTeam);

  return shuffleInPlace([
    ...Array<CodenamesAffiliation>(9).fill(startingTeam),
    ...Array<CodenamesAffiliation>(8).fill(otherTeam),
    ...Array<CodenamesAffiliation>(7).fill("neutral"),
    "assassin",
  ]);
}

export function createCodenamesBoard(
  startingTeam: CodenamesTeam,
  wordPool: readonly string[] = CODENAMES_WORDS,
): CodenamesCard[] {
  const uniqueWords = new Map<string, string>();

  for (const rawWord of wordPool) {
    const word = rawWord.trim();

    if (!word) continue;
    const normalized = word.toLocaleLowerCase();

    if (!uniqueWords.has(normalized)) uniqueWords.set(normalized, word);
  }

  if (uniqueWords.size < BOARD_SIZE) {
    throw new Error("Codenames requires at least 25 unique words");
  }

  const words = shuffleInPlace([...uniqueWords.values()]).slice(0, BOARD_SIZE);
  const affiliations = createCodenamesAffiliations(startingTeam);

  return words.map((word, index) => ({
    index,
    word,
    affiliation: affiliations[index]!,
    revealed: false,
    revealedBy: null,
  }));
}

/** Assign one spymaster per team, then balance all remaining operatives. */
export function createCodenamesAssignments(playerIds: readonly string[]): CodenamesAssignments {
  if (playerIds.length < MIN_PLAYERS || playerIds.length > MAX_PLAYERS) {
    throw new Error(`Codenames requires ${MIN_PLAYERS}–${MAX_PLAYERS} players`);
  }

  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error("Codenames player IDs must be unique");
  }

  const order = shuffleInPlace([...playerIds]);

  const assignments: CodenamesAssignments = {
    [order[0]!]: { team: "red", role: "spymaster" },
    [order[1]!]: { team: "blue", role: "spymaster" },
  };

  for (let index = 2; index < order.length; index++) {
    assignments[order[index]!] = {
      team: index % 2 === 0 ? "red" : "blue",
      role: "operative",
    };
  }

  return assignments;
}

/** Fill missing lobby roles while retaining valid explicit choices. */
export function normalizeCodenamesAssignments(
  playerIds: readonly string[],
  existing: Readonly<CodenamesAssignments> = {},
): CodenamesAssignments {
  const ids = [...new Set(playerIds)];
  const assignments: CodenamesAssignments = {};

  for (const id of ids) {
    const assignment = existing[id];

    if (
      assignment &&
      (assignment.team === "red" || assignment.team === "blue") &&
      (assignment.role === "spymaster" || assignment.role === "operative")
    ) {
      assignments[id] = { ...assignment };
    }
  }

  for (const team of ["red", "blue"] as const) {
    if (ids.some((id) => assignments[id]?.team === team && assignments[id]?.role === "spymaster"))
      continue;
    const candidate = ids.find((id) => !assignments[id]);

    if (candidate) assignments[candidate] = { team, role: "spymaster" };
  }

  for (const id of ids) {
    if (assignments[id]) continue;
    const red = ids.filter((candidate) => assignments[candidate]?.team === "red").length;
    const blue = ids.filter((candidate) => assignments[candidate]?.team === "blue").length;
    assignments[id] = { team: red <= blue ? "red" : "blue", role: "operative" };
  }

  return assignments;
}

export function validateCodenamesAssignments(
  playerIds: readonly string[],
  assignments: Readonly<CodenamesAssignments>,
): string | null {
  const current = playerIds.map((playerId) => assignments[playerId]);

  if (current.some((assignment) => !assignment)) {
    return "Assign every player to a Codenames role before starting";
  }

  for (const team of ["red", "blue"] as const) {
    const teamAssignments = current.filter((assignment) => assignment?.team === team);

    if (teamAssignments.filter((assignment) => assignment?.role === "spymaster").length !== 1) {
      return `Assign exactly one ${team} spymaster`;
    }

    if (!teamAssignments.some((assignment) => assignment?.role === "operative")) {
      return `Assign at least one ${team} operative`;
    }
  }

  const redCount = current.filter((assignment) => assignment?.team === "red").length;
  const blueCount = current.length - redCount;

  if (Math.abs(redCount - blueCount) > 1) {
    return "Red and blue teams must be balanced within one player";
  }

  return null;
}

export function projectCodenamesBoard(
  board: readonly CodenamesCard[],
  revealKey: boolean,
): Array<
  Omit<CodenamesCard, "affiliation"> & {
    affiliation: CodenamesAffiliation | null;
  }
> {
  return board.map((card) => ({
    ...card,
    affiliation: revealKey || card.revealed ? card.affiliation : null,
  }));
}

/** Server-authoritative official competitive Codenames. */
export class CodenamesGameRoom extends BaseGameRoom<CodenamesGameState> {
  protected readonly roomLabel = "CodenamesGameRoom";

  constructor(state: RoomRuntime, env: Env) {
    super(state, env);
  }

  protected get minPlayersToStart(): number {
    return MIN_PLAYERS;
  }

  protected get initialTurnPhase(): string {
    return "clue";
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
  ): CodenamesGameState {
    const createdAt = Date.now();
    const gameTotalTime = config.gameTotalTime ?? 30 * 60 * 1000;
    const turnTime = Math.max(config.turnTime ?? 60 * 1000, 30 * 1000);

    return {
      id: randomId(),
      roomCode,
      type: "codenames",
      status: "waiting",
      players: [{ id: config.hostId, name: config.hostName }],
      hostId: config.hostId,
      maxPlayers: Math.min(Math.max(config.maxPlayers ?? MAX_PLAYERS, MIN_PLAYERS), MAX_PLAYERS),
      timerConfig: { gameTotalTime, turnTime },
      gameTimeRemaining: gameTotalTime,
      turnState: {
        currentPlayerId: null,
        turnNumber: 0,
        phase: "waiting",
        startedAt: 0,
        turnTimeRemaining: turnTime,
      },
      createdAt,
      updatedAt: createdAt,
      expiresAt: createdAt + ROOM_LIFETIME_MS,
      board: [],
      assignments: { [config.hostId]: { team: "red", role: "spymaster" } },
      startingTeam: "red",
      activeTeam: "red",
      clue: null,
      guessesRemaining: 0,
      guessesMade: 0,
      remaining: { red: 0, blue: 0 },
      winner: null,
      winnerTeam: null,
      activityLog: [],
      lastReveal: null,
    };
  }

  protected onStartGame(): void {
    if (!this.gameState) return;
    const startingTeam: CodenamesTeam = randomInt(2) === 0 ? "red" : "blue";

    const assignments = Object.fromEntries(
      this.gameState.players.map((player) => [player.id, this.gameState!.assignments[player.id]!]),
    );

    this.gameState.startingTeam = startingTeam;
    this.gameState.activeTeam = startingTeam;
    this.gameState.assignments = assignments;
    this.gameState.board = createCodenamesBoard(startingTeam);
    this.gameState.remaining = {
      red: startingTeam === "red" ? 9 : 8,
      blue: startingTeam === "blue" ? 9 : 8,
    };
    this.gameState.clue = null;
    this.gameState.guessesRemaining = 0;
    this.gameState.guessesMade = 0;
    this.gameState.winner = null;
    this.gameState.winnerTeam = null;
    this.gameState.activityLog = [];
    this.gameState.lastReveal = null;
    this.gameState.turnState.phase = "clue";
    this.gameState.turnState.currentPlayerId = this.spymasterFor(startingTeam)?.id ?? null;
    this.gameState.turnState.turnNumber = 1;
  }

  protected projectStateFor(playerId: string, state: CodenamesGameState) {
    const assignment = state.assignments[playerId];
    const revealKey = state.status === "ended" || assignment?.role === "spymaster";

    return {
      ...state,
      board: projectCodenamesBoard(state.board, revealKey),
    };
  }

  protected buildRewatchView(): object | null {
    return this.gameState;
  }

  protected onRoomMemberRoleChanged(playerId: string, role: "player" | "spectator"): void {
    if (role === "spectator" && this.gameState) {
      delete this.gameState.assignments[playerId];
    }
  }

  protected async saveState(): Promise<void> {
    if (this.gameState?.status === "waiting") {
      this.gameState.assignments = normalizeCodenamesAssignments(
        this.gameState.players.map((player) => player.id),
        this.gameState.assignments,
      );
    }

    await super.saveState();
  }

  protected isYourTurn(playerId: string): boolean {
    if (!this.gameState || this.gameState.status !== "playing") return false;
    const assignment = this.gameState.assignments[playerId];

    if (!assignment || assignment.team !== this.gameState.activeTeam) return false;

    return this.gameState.turnState.phase === "clue"
      ? assignment.role === "spymaster"
      : this.gameState.turnState.phase === "guess" && assignment.role === "operative";
  }

  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId);

    if (this.gameState?.status === "waiting") {
      actions.push("assign_codenames_role");

      if (this.gameState.hostId === playerId) {
        actions.push("reset_codenames_roles", "randomize_codenames_roles");
      }
    }

    if (!this.gameState || !this.isYourTurn(playerId)) return actions;

    if (this.gameState.turnState.phase === "clue") {
      actions.push("give_clue");
    } else if (this.gameState.turnState.phase === "guess") {
      actions.push("guess_word");

      if (this.gameState.guessesMade > 0) actions.push("end_turn");
    }

    return actions;
  }

  protected buildYouContext(playerId: string) {
    const base = super.buildYouContext(playerId);
    const assignment = this.gameState?.assignments[playerId] ?? null;

    return {
      ...base,
      isYourTurn: this.isYourTurn(playerId),
      team: assignment?.team ?? null,
      role: base.isSpectator ? "spectator" : (assignment?.role ?? null),
      canSeeKey: this.gameState?.status === "ended" || assignment?.role === "spymaster",
      legalActions: this.getLegalActions(playerId),
    };
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    switch (payload.actionType) {
      case "assign_codenames_role":
        return this.handleAssignRole(player, payload.data);
      case "reset_codenames_roles":
        return this.handleResetRoles(player);
      case "randomize_codenames_roles":
        return this.handleRandomizeRoles(player);
      case "give_clue":
        return this.handleGiveClue(player, payload.data);
      case "guess_word":
      case "guess":
        return this.handleGuess(player, payload.data);
      case "end_turn":
      case "stop_guessing":
        return this.handleEndTurn(player);
      default:
        return `Unknown action: ${payload.actionType}`;
    }
  }

  protected validateStartGame(): string | null {
    if (!this.gameState) return "Codenames room is unavailable";

    return validateCodenamesAssignments(
      this.gameState.players.map((player) => player.id),
      this.gameState.assignments,
    );
  }

  private handleAssignRole(player: Player, data: WireValue): string | void {
    if (!this.gameState || this.gameState.status !== "waiting") {
      return "Codenames roles can only be arranged in the lobby";
    }

    if (!isWireObject(data)) {
      return "Player, team, and role are required";
    }

    const playerId = data.playerId;
    const team = data.team;
    const role = data.role;

    if (!isString(playerId)) return "Choose a room member";
    const isHost = this.gameState.hostId === player.id;

    if (!isHost && playerId !== player.id) {
      return "Players can only choose their own Codenames role";
    }

    const isSeated = this.gameState.players.some((candidate) => candidate.id === playerId);
    const isSpectating = this.ensureSpectators().some((candidate) => candidate.id === playerId);

    if (!isSeated && !isSpectating) return "Choose a room member";

    if (team === null && role === null) {
      if (!isSeated) return "Choose a team role to claim a player seat";
      const next = { ...this.gameState.assignments };
      delete next[playerId];
      this.gameState.assignments = normalizeCodenamesAssignments(
        this.gameState.players.map((candidate) => candidate.id),
        next,
      );

      return;
    }

    if ((team !== "red" && team !== "blue") || (role !== "spymaster" && role !== "operative")) {
      return "Team must be red or blue and role must be spymaster or operative";
    }

    const occupiedSpymaster =
      role === "spymaster"
        ? Object.entries(this.gameState.assignments).find(
            ([assignedPlayerId, assignment]) =>
              assignedPlayerId !== playerId &&
              assignment.team === team &&
              assignment.role === "spymaster" &&
              this.gameState?.players.some((candidate) => candidate.id === assignedPlayerId),
          )
        : undefined;

    if (occupiedSpymaster && !isHost) {
      return `The ${team} spymaster role is already taken`;
    }

    if (isSpectating) {
      if (playerId !== player.id && !isHost) {
        return "Only the host can assign another spectator to a player seat";
      }

      const promotionError = this.promoteSpectatorToPlayer(playerId);

      if (promotionError) return promotionError;
    }

    if (role === "spymaster") {
      for (const [assignedPlayerId, assignment] of Object.entries(this.gameState.assignments)) {
        if (
          assignedPlayerId !== playerId &&
          assignment.team === team &&
          assignment.role === "spymaster" &&
          this.gameState.players.some((candidate) => candidate.id === assignedPlayerId)
        ) {
          this.gameState.assignments[assignedPlayerId] = {
            team,
            role: "operative",
          };
        }
      }
    }

    this.gameState.assignments[playerId] = { team, role };
  }

  private handleResetRoles(player: Player): string | void {
    if (!this.gameState || this.gameState.status !== "waiting") {
      return "Codenames roles can only be reset in the lobby";
    }

    if (this.gameState.hostId !== player.id) {
      return "Only the host can reset Codenames teams";
    }

    this.gameState.assignments = normalizeCodenamesAssignments(
      this.gameState.players.map((candidate) => candidate.id),
    );
  }

  private handleRandomizeRoles(player: Player): string | void {
    if (!this.gameState || this.gameState.status !== "waiting") {
      return "Codenames roles can only be randomized in the lobby";
    }

    if (this.gameState.hostId !== player.id) {
      return "Only the host can randomize Codenames teams";
    }

    if (this.gameState.players.length < MIN_PLAYERS) {
      return `Codenames needs at least ${MIN_PLAYERS} players before randomizing teams`;
    }

    this.gameState.assignments = createCodenamesAssignments(
      this.gameState.players.map((candidate) => candidate.id),
    );
  }

  private handleGiveClue(player: Player, data: WireValue): string | void {
    if (!this.gameState || this.gameState.status !== "playing") {
      return "Game is not playing";
    }

    const assignment = this.gameState.assignments[player.id];

    if (
      this.gameState.turnState.phase !== "clue" ||
      assignment?.team !== this.gameState.activeTeam ||
      assignment.role !== "spymaster"
    ) {
      return "Only the active team's spymaster can give a clue";
    }

    if (!isWireObject(data)) {
      return "Clue word and count are required";
    }

    const wordRaw = data.word;
    const countRaw = data.count;
    const word = isString(wordRaw) ? wordRaw.trim() : "";

    if (word.length < 1 || word.length > 40 || !/^[\p{L}\p{M}][\p{L}\p{M}'-]*$/u.test(word)) {
      return "Official clues must be a single word";
    }

    const normalizedWord = word.toLocaleLowerCase();

    if (
      this.gameState.board.some(
        (card) => !card.revealed && card.word.toLocaleLowerCase() === normalizedWord,
      )
    ) {
      return "A visible codename cannot be used as the clue";
    }

    const count =
      isString(countRaw) && countRaw.trim().toLocaleLowerCase() === "unlimited"
        ? "unlimited"
        : isNumber(countRaw) && Number.isInteger(countRaw) && countRaw >= 0 && countRaw <= 9
          ? countRaw
          : null;

    if (count === null) return "Clue count must be 0–9 or unlimited";

    this.gameState.clue = { word, count, givenBy: player.id, at: Date.now() };
    this.gameState.guessesMade = 0;
    this.gameState.guessesRemaining = count === 0 || count === "unlimited" ? null : count + 1;
    this.gameState.turnState.phase = "guess";
    // Guessing belongs to the active operative group, not one representative
    // player. `isYourTurn` and legal actions wake every operative on the team.
    this.gameState.turnState.currentPlayerId = null;
    this.resetTurnTimer();
    this.appendActivity({
      type: "clue",
      team: assignment.team,
      playerId: player.id,
      word,
      count,
    });
    this.recordEvent("clue_given", {
      playerId: player.id,
      team: assignment.team,
      word,
      count,
    });
  }

  private handleGuess(player: Player, data: WireValue): string | void {
    if (!this.gameState || this.gameState.status !== "playing") {
      return "Game is not playing";
    }

    const assignment = this.gameState.assignments[player.id];

    if (
      this.gameState.turnState.phase !== "guess" ||
      assignment?.team !== this.gameState.activeTeam ||
      assignment.role !== "operative"
    ) {
      return "Only an operative on the active team can guess";
    }

    if (!isWireObject(data)) {
      return "Guess index or word is required";
    }

    const indexRaw = data.index;
    const wordRaw = data.word;

    const card =
      isNumber(indexRaw) && Number.isInteger(indexRaw)
        ? this.gameState.board[indexRaw]
        : isString(wordRaw)
          ? this.gameState.board.find(
              (candidate) =>
                candidate.word.toLocaleLowerCase() === wordRaw.trim().toLocaleLowerCase(),
            )
          : undefined;

    if (!card) return "Choose a board index 0–24 or an exact visible word";

    if (card.revealed) return "That codename is already revealed";

    card.revealed = true;
    card.revealedBy = player.id;
    this.gameState.guessesMade++;
    this.gameState.lastReveal = {
      index: card.index,
      word: card.word,
      affiliation: card.affiliation,
      playerId: player.id,
    };
    this.appendActivity({
      type: "guess",
      team: assignment.team,
      playerId: player.id,
      word: card.word,
      affiliation: card.affiliation,
    });

    if (card.affiliation === "red" || card.affiliation === "blue") {
      this.gameState.remaining[card.affiliation] = Math.max(
        0,
        this.gameState.remaining[card.affiliation] - 1,
      );
    }

    this.recordEvent("word_guessed", {
      playerId: player.id,
      team: assignment.team,
      index: card.index,
      word: card.word,
      affiliation: card.affiliation,
    });

    if (card.affiliation === "assassin") {
      this.finishGame(otherCodenamesTeam(assignment.team), "assassin");

      return;
    }

    if (
      (card.affiliation === "red" || card.affiliation === "blue") &&
      this.gameState.remaining[card.affiliation] === 0
    ) {
      this.finishGame(card.affiliation, "all_agents_contacted");

      return;
    }

    if (card.affiliation !== assignment.team) {
      this.advanceTeam("wrong_guess");

      return;
    }

    if (this.gameState.guessesRemaining !== null) {
      this.gameState.guessesRemaining--;

      if (this.gameState.guessesRemaining <= 0) {
        this.advanceTeam("guess_limit");

        return;
      }
    }
    // A correct guess does not restart the group decision clock. The configured
    // turn timer covers the entire operative phase, matching the catalog rule.
  }

  private handleEndTurn(player: Player): string | void {
    if (!this.gameState || this.gameState.status !== "playing") {
      return "Game is not playing";
    }

    const assignment = this.gameState.assignments[player.id];

    if (
      this.gameState.turnState.phase !== "guess" ||
      assignment?.team !== this.gameState.activeTeam ||
      assignment.role !== "operative"
    ) {
      return "Only an operative on the active team can end guessing";
    }

    if (this.gameState.guessesMade < 1) {
      return "Official rules require at least one guess before stopping";
    }

    this.advanceTeam("stopped", player.id);
  }

  protected async onTurnTimeout(playerId: string | null): Promise<void> {
    if (!this.gameState || this.gameState.status !== "playing") return;
    this.advanceTeam("timeout", playerId);
    await this.saveState();
    this.broadcastState();
  }

  protected onGameTimeout(): void {
    if (!this.gameState) return;
    // Official Codenames has no partial-board tiebreaker. The platform's
    // optional overall room clock therefore ends an unfinished board as a draw.
    this.gameState.winner = "draw";
    this.gameState.winnerTeam = null;
    this.appendActivity({
      type: "game_end",
      team: null,
      playerId: null,
      reason: "game_timeout",
      winner: "draw",
    });
    this.gameState.turnState.phase = "ended";
    this.gameState.turnState.currentPlayerId = null;
  }

  private advanceTeam(
    reason: "stopped" | "timeout" | "wrong_guess" | "guess_limit",
    playerId: string | null = null,
  ): void {
    if (!this.gameState) return;
    this.appendActivity({
      type: "turn_end",
      team: this.gameState.activeTeam,
      playerId,
      reason,
    });
    this.gameState.activeTeam = otherCodenamesTeam(this.gameState.activeTeam);
    this.gameState.clue = null;
    this.gameState.guessesRemaining = 0;
    this.gameState.guessesMade = 0;
    this.gameState.turnState.phase = "clue";
    this.gameState.turnState.turnNumber++;
    this.gameState.turnState.currentPlayerId =
      this.spymasterFor(this.gameState.activeTeam)?.id ?? null;
    this.resetTurnTimer();
    this.recordEvent("turn_changed", {
      currentPlayerId: this.gameState.turnState.currentPlayerId,
      turnNumber: this.gameState.turnState.turnNumber,
      phase: "clue",
      activeTeam: this.gameState.activeTeam,
    });
  }

  private finishGame(winner: CodenamesTeam, reason: string): void {
    if (!this.gameState) return;
    this.gameState.winner = winner;
    this.gameState.winnerTeam = winner;
    this.gameState.status = "ended";
    this.gameState.turnState.phase = "ended";
    this.gameState.turnState.currentPlayerId = null;
    this.stopTimers();
    this.appendActivity({
      type: "game_end",
      team: winner,
      playerId: null,
      reason: reason === "assassin" ? "assassin" : "all_agents_contacted",
      winner,
    });
    this.recordEvent("game_ended", { reason, winner, remaining: this.gameState.remaining });
    void this.saveState().then(() => {
      this.broadcastProjected("game_ended", { reason });
    });
  }

  private resetTurnTimer(): void {
    if (!this.gameState) return;
    this.gameState.turnState.turnTimeRemaining = this.gameState.timerConfig.turnTime;
    this.gameState.turnState.startedAt = Date.now();
  }

  private appendActivity(entry: Omit<CodenamesLogEntry, "at">): void {
    if (!this.gameState) return;
    const activityLog = (this.gameState.activityLog ??= []);
    activityLog.push({ ...entry, at: Date.now() });

    if (activityLog.length > 80) {
      activityLog.splice(0, activityLog.length - 80);
    }
  }

  private spymasterFor(team: CodenamesTeam) {
    return this.gameState?.players.find((player) => {
      const assignment = this.gameState?.assignments[player.id];

      return assignment?.team === team && assignment.role === "spymaster";
    });
  }
}
