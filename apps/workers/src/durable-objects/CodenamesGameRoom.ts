import { isString, isWireObject, type WireValue } from "@llmgames/game-catalog";

import type { RoomRuntime } from "./runtime";

import { BaseGameRoom } from "./BaseGameRoom";
import type { Env } from "../types";
import type { CodenamesGameState, Player } from "./types";
import type { StartGameProblem } from "./actionErrors";
import { codenamesPlugin } from "../games/codenames/plugin";
import {
  createCodenamesAssignments,
  normalizeCodenamesAssignments,
} from "../games/codenames/rules";

/**
 * Codenames room (M3.6).
 *
 * Platform concerns stay here; the rules — the key, clues, guesses, turn
 * transitions and both timeouts — live in {@link codenamesPlugin}. Class name,
 * namespace and persisted state shape are unchanged from the pre-plugin
 * implementation, so live rooms keep restoring.
 *
 * Lobby role assignment stays in this class on purpose: choosing a team is a seat
 * change (it can promote a spectator into a player seat), and §3.2 of the design
 * keeps seats in the platform layer. Only play actions go through the plugin.
 *
 * Phases: lobby → clue → guess → ended
 * Actions: give_clue, guess_word (guess), end_turn (stop_guessing)
 */

export {
  createCodenamesAffiliations,
  createCodenamesAssignments,
  createCodenamesBoard,
  normalizeCodenamesAssignments,
  otherCodenamesTeam,
  projectCodenamesBoard,
  validateCodenamesAssignments,
} from "../games/codenames/rules";

export class CodenamesGameRoom extends BaseGameRoom<CodenamesGameState> {
  protected readonly roomLabel = "CodenamesGameRoom";

  constructor(state: RoomRuntime, env: Env) {
    super(state, env);
  }

  protected gameRules() {
    return codenamesPlugin;
  }

  protected get minPlayersToStart(): number {
    return codenamesPlugin.minPlayersToStart;
  }

  protected get initialTurnPhase(): string {
    return codenamesPlugin.initialTurnPhase;
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
    return codenamesPlugin.createInitialState(config, roomCode, Date.now());
  }

  protected onStartGame(): void {
    if (!this.gameState) return;

    codenamesPlugin.start(this.gameState, {
      firstPlayerIndex: this.startingPlayerIndex(),
      now: Date.now(),
    });
  }

  protected validateStartGame(): StartGameProblem | null {
    return super.validateStartGame();
  }

  protected getLegalActions(playerId: string): string[] {
    const actions = super.getLegalActions(playerId);

    if (!this.gameState) return actions;

    return [
      ...actions,
      ...codenamesPlugin.turnActions(this.gameState, playerId, {
        isSpectator: this.isSpectator(playerId),
      }),
    ];
  }

  protected buildYouContext(playerId: string) {
    const base = super.buildYouContext(playerId);

    if (!this.gameState) return base;

    const viewer = { isSpectator: base.isSpectator };

    return {
      ...base,
      ...codenamesPlugin.seatIdentity(this.gameState, playerId, viewer),
      ...codenamesPlugin.youFields?.(this.gameState, playerId, viewer),
    };
  }

  protected onRoomMemberRoleChanged(playerId: string, role: "player" | "spectator"): void {
    super.onRoomMemberRoleChanged(playerId, role);
  }

  /**
   * Normalize the lobby's roles on every save.
   *
   * Joining players get a seat before the host assigns anything, so the persisted
   * lobby must be valid at all times; this runs before the write, exactly as the
   * pre-plugin room did.
   */
  protected async saveState(): Promise<void> {
    if (this.gameState?.status === "waiting") {
      this.gameState.assignments = normalizeCodenamesAssignments(
        this.gameState.players.map((player) => player.id),
        this.gameState.assignments,
      );
    }

    await super.saveState();
  }

  protected async handleGameAction(
    player: Player,
    payload: { actionType: string; data: WireValue },
  ): Promise<string | void> {
    if (!this.gameState) return "No game state";

    switch (payload.actionType) {
      case "assign_codenames_role":
        return this.handleAssignRole(player, payload.data);
      case "reset_codenames_roles":
        return this.handleResetRoles(player);
      case "randomize_codenames_roles":
        return this.handleRandomizeRoles(player);
      default:
        break;
    }

    const result = codenamesPlugin.applyAction(this.gameState, player.id, payload, Date.now());

    if (!result.ok) return result.message;

    this.applyGameEffects(result.effects);
  }

  protected async onTurnTimeout(playerId: string | null): Promise<void> {
    if (!this.gameState) return;

    this.applyGameEffects(
      codenamesPlugin.onTurnTimeout?.(this.gameState, playerId, Date.now()) ?? [],
    );
    await this.settleRuleTimeout();
  }

  protected onGameTimeout(): void {
    if (!this.gameState) return;

    codenamesPlugin.onMatchTimeout?.(this.gameState, Date.now());
  }

  private handleAssignRole(player: Player, data: WireValue): string | void {
    if (!this.gameState || this.gameState.status !== "waiting") {
      return "Codenames roles can only be arranged in the lobby";
    }

    if (!isWireObject(data)) return "Player, team, and role are required";

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
          this.gameState.assignments[assignedPlayerId] = { team, role: "operative" };
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

    if (this.gameState.players.length < codenamesPlugin.minPlayersToStart) {
      return `Codenames needs at least ${codenamesPlugin.minPlayersToStart} players before randomizing teams`;
    }

    this.gameState.assignments = createCodenamesAssignments(
      this.gameState.players.map((candidate) => candidate.id),
    );
  }
}
