import { isString, isWireObject, wireValueSchema, type WireValue } from "@llmgames/game-catalog";

import {
  BATTLESHIP_CANNON_POINT_REWARD,
  BATTLESHIP_DAMAGE_POINT_REWARD,
  BATTLESHIP_STARTING_MUNITION_POINTS,
  BATTLESHIP_TURN_POINT_REWARD,
  BATTLESHIP_WEAPON_COSTS,
  resolveTorpedoDirection,
  TORPEDO_DELTAS,
} from "../../durable-objects/types";
import type {
  BattleshipGameState,
  BattleshipPlayerBoard,
  BattleShot,
  ShipId,
  WeaponId,
} from "../../durable-objects/types";
import { randomId, randomInt } from "../../lib/csprng";
import type { GameActionResult, GameEffect, GameIntent } from "../contract";
import {
  BATTLESHIP_SIZE,
  maxUsesFromPoints,
  parseCell,
  parseFleetPayload,
  randomFleet,
  shipName,
  shotAt,
  validateFleet,
} from "./rules";

/**
 * Battleship intents (M3.5).
 *
 * Each handler validates, mutates the state it is given and returns the effects
 * the platform should perform. Storage, broadcasts and the clock stay platform
 * work, which is what lets one script compare the plugin against the legacy room
 * shot by shot.
 */

/** Order players fire in when the battle starts. */
function firstPlayerIndex(state: BattleshipGameState): number {
  if (state.series)
    return Math.max(
      0,
      state.players.findIndex((player) => player.id === state.series!.firstPlayerId),
    );

  return randomInt(state.players.length);
}

function awardTurnPoints(state: BattleshipGameState, playerId: string): void {
  const board = state.boards.find((b) => b.playerId === playerId);

  if (!board) return;

  board.munitionPoints = (board.munitionPoints ?? 0) + BATTLESHIP_TURN_POINT_REWARD;
  board.weapons = maxUsesFromPoints(board.munitionPoints);
}

function spendMunitions(board: BattleshipPlayerBoard, weapon: WeaponId): string | void {
  const cost = BATTLESHIP_WEAPON_COSTS[weapon];
  const pts = board.munitionPoints ?? 0;

  if (pts < cost) return `Need ${cost} munition pt(s) for ${weapon} (you have ${pts})`;

  board.munitionPoints = pts - cost;
  board.weapons = maxUsesFromPoints(board.munitionPoints);
}

function refundMunitions(board: BattleshipPlayerBoard, weapon: WeaponId): void {
  board.munitionPoints = (board.munitionPoints ?? 0) + BATTLESHIP_WEAPON_COSTS[weapon];
  board.weapons = maxUsesFromPoints(board.munitionPoints);
}

/** Start the battle: the drawn first player fires, and gains turn energy. */
function beginBattle(
  state: BattleshipGameState,
  now: number,
  prefix?: string,
): GameEffect[] {
  const first = state.players[firstPlayerIndex(state)]!;

  state.turnState.phase = "battle";
  state.turnState.currentPlayerId = first.id;
  awardTurnPoints(state, first.id);
  state.turnState.turnNumber = 1;
  state.turnState.turnTimeRemaining = state.timerConfig.turnTime;
  state.turnState.startedAt = now;
  state.lastAnnouncement = `${prefix ? `${prefix} ` : ""}Battle stations! ${first.name} fires first.`;

  return [{ type: "event", event: "battle_start", data: { firstPlayerId: first.id } }];
}

function battleTurn(
  state: BattleshipGameState,
  playerId: string,
):
  | { ok: true; board: BattleshipPlayerBoard; opp: BattleshipPlayerBoard }
  | { ok: false; error: string } {
  if (state.status !== "playing") return { ok: false, error: "Game is not playing" };

  if (state.turnState.phase !== "battle") return { ok: false, error: "Not battle phase" };

  if (state.turnState.currentPlayerId !== playerId) return { ok: false, error: "Not your turn" };

  const board = state.boards.find((b) => b.playerId === playerId);
  const opp = state.boards.find((b) => b.playerId !== playerId);

  if (!board || !opp) return { ok: false, error: "No board" };

  return { ok: true, board, opp };
}

/**
 * Apply one shot to a cell; null means the cell was already hit.
 *
 * Sinking a ship flips it to `sunk` as soon as every occupied cell has a hit,
 * which also feeds the "all ships sunk" result in {@link finishAttackTurn}.
 */
function applyAttack(
  state: BattleshipGameState,
  attacker: BattleshipPlayerBoard,
  opp: BattleshipPlayerBoard,
  row: number,
  col: number,
  weapon: BattleShot["weapon"],
  effects: GameEffect[],
  salvoId?: string,
): BattleShot | null {
  if (shotAt(state, attacker.playerId, row, col)) return null;

  const shipId = opp.cells[row]![col];
  const hit = shipId !== null;
  let sunkShipId: ShipId | undefined;

  if (hit && shipId) {
    const ship = opp.ships.find((s) => s.id === shipId)!;

    if (!ship.sunk) {
      const hitCells = new Set(
        state.shots
          .filter((shot) => shot.byPlayerId === attacker.playerId && shot.hit)
          .map((shot) => `${shot.row}:${shot.col}`),
      );

      hitCells.add(`${row}:${col}`);

      const occupiedCells = opp.cells.flatMap((line, r) =>
        line.flatMap((id, c) => (id === shipId ? [`${r}:${c}`] : [])),
      );

      ship.hits = occupiedCells.filter((cell) => hitCells.has(cell)).length;

      if (occupiedCells.length > 0 && occupiedCells.every((cell) => hitCells.has(cell))) {
        ship.sunk = true;
        sunkShipId = shipId;
      }
    }
  }

  attacker.shotsFired++;

  if (weapon === "mine") (opp.mineShots ??= []).push({ row, col });

  if (hit) {
    if (weapon === "mine") (opp.mineHits ??= []).push({ row, col });
    attacker.hitsScored++;
    opp.munitionPoints += BATTLESHIP_DAMAGE_POINT_REWARD;
    opp.weapons = maxUsesFromPoints(opp.munitionPoints);
  }

  const shot: BattleShot = {
    row,
    col,
    hit,
    sunkShipId,
    byPlayerId: attacker.playerId,
    weapon,
    salvoId,
  };

  state.shots.push(shot);

  const mineIndex = opp.mines?.findIndex((m) => m.row === row && m.col === col) ?? -1;

  if (mineIndex >= 0) {
    opp.mines!.splice(mineIndex, 1);
    (opp.triggeredMines ??= []).push({ row, col });
    const retaliation: BattleShot[] = [];

    for (let i = 0; i < 3; i++) {
      const targets = Array.from({ length: BATTLESHIP_SIZE * BATTLESHIP_SIZE }, (_, index) => ({
        row: Math.floor(index / BATTLESHIP_SIZE),
        col: index % BATTLESHIP_SIZE,
      })).filter((cell) => !shotAt(state, opp.playerId, cell.row, cell.col));

      if (!targets.length) break;

      const target = targets[randomInt(targets.length)]!;

      const returned = applyAttack(
        state,
        opp,
        attacker,
        target.row,
        target.col,
        "mine",
        effects,
      );

      if (returned) retaliation.push(returned);
    }

    effects.push({
      type: "event",
      event: "mine_triggered",
      // SAFETY: BattleShot is a flat JSON record of primitives; the schema is the
      // same gate `recordEvent` applies to every other summary.
      data: wireValueSchema.parse({
        playerId: opp.playerId,
        row,
        col,
        shots: retaliation,
      }),
    });
  }

  return shot;
}

/**
 * Close an attack action.
 *
 * - a cannon hit keeps the turn and refreshes the timer;
 * - an ability keeps the turn without refreshing it, so stalling still costs time;
 * - a miss passes the turn and pays the opponent's next-turn energy.
 */
function finishAttackTurn(
  state: BattleshipGameState,
  playerId: string,
  opp: BattleshipPlayerBoard,
  shots: BattleShot[],
  announcement: string,
  now: number,
  keepTurn = false,
  refreshTimer = true,
): GameEffect[] {
  const effects: GameEffect[] = [];
  const firstShotIndex = shots.length ? state.shots.indexOf(shots[0]!) : -1;

  const returnedShots =
    firstShotIndex >= 0
      ? state.shots.slice(firstShotIndex).filter((s) => s.weapon === "mine")
      : [];

  if (returnedShots.length)
    announcement += ` Mines triggered: ${returnedShots.length} return shots, ${returnedShots.filter((s) => s.hit).length} hits.`;

  state.lastAnnouncement = announcement;

  effects.push({
    type: "event",
    event: "attack",
    data: {
      playerId,
      shots: shots.map((s) => ({
        row: s.row,
        col: s.col,
        hit: s.hit,
        sunkShipId: s.sunkShipId,
        weapon: s.weapon,
      })),
      announcement,
      keepTurn,
    },
  });

  const own = state.boards.find((b) => b.playerId === playerId)!;
  const ownSunk = own.ships.every((s) => s.sunk);
  const opponentSunk = opp.ships.every((s) => s.sunk);

  if (ownSunk || opponentSunk) {
    const winner = ownSunk && opponentSunk ? null : ownSunk ? opp.playerId : playerId;

    state.winner = winner;
    state.status = "ended";
    state.turnState.phase = "ended";
    state.lastAnnouncement = winner
      ? `${state.players.find((p) => p.id === winner)?.name} wins. Enemy fleet sunk!`
      : "Both fleets sunk. Draw.";

    return [
      ...effects,
      { type: "stop_timers" },
      { type: "event", event: "game_ended", data: { reason: "fleet_sunk", winner } },
      { type: "match_ended", reason: "fleet_sunk" },
    ];
  }

  if (keepTurn) {
    if (!refreshTimer) return effects;

    state.turnState.turnTimeRemaining = state.timerConfig.turnTime;
    state.turnState.startedAt = now;
    effects.push({
      type: "event",
      event: "extra_shot",
      data: {
        currentPlayerId: playerId,
        phase: "battle",
        turnNumber: state.turnState.turnNumber,
        reason: "cannon_hit",
      },
    });

    return effects;
  }

  state.turnState.currentPlayerId = opp.playerId;
  awardTurnPoints(state, opp.playerId);
  state.turnState.turnNumber++;
  state.turnState.turnTimeRemaining = state.timerConfig.turnTime;
  state.turnState.startedAt = now;

  effects.push({
    type: "event",
    event: "turn_changed",
    data: {
      currentPlayerId: opp.playerId,
      phase: "battle",
      turnNumber: state.turnState.turnNumber,
    },
  });

  return effects;
}

/** Abilities keep the turn and never refresh the timer. */
function finishAbility(
  state: BattleshipGameState,
  playerId: string,
  opponent: BattleshipPlayerBoard,
  shots: BattleShot[],
  announcement: string,
  now: number,
): GameEffect[] {
  return finishAttackTurn(state, playerId, opponent, shots, announcement, now, true, false);
}

function handlePlace(
  state: BattleshipGameState,
  playerId: string,
  data: WireValue,
  now: number,
): GameActionResult {
  if (state.status !== "playing") return { ok: false, message: "Game is not playing" };

  if (state.turnState.phase !== "placement") return { ok: false, message: "Not placement phase" };

  const player = state.players.find((p) => p.id === playerId);
  const board = state.boards.find((b) => b.playerId === playerId);

  if (!player || !board) return { ok: false, message: "No board" };

  if (board.ready) return { ok: false, message: "Fleet already placed" };

  const placements = parseFleetPayload(data);

  if (!placements) return { ok: false, message: "ships must be a valid fleet placement array" };

  const result = validateFleet(placements);

  if (!result.ok) return { ok: false, message: result.error };

  board.ships = result.ships;
  board.cells = result.cells;
  board.ready = true;
  board.munitionPoints = BATTLESHIP_STARTING_MUNITION_POINTS;
  board.weapons = maxUsesFromPoints(board.munitionPoints);

  state.lastAnnouncement = `${player.name} locked fleet.`;

  const effects: GameEffect[] = [
    { type: "event", event: "place_fleet", data: { playerId, ready: true } },
  ];

  if (state.boards.every((b) => b.ready)) effects.push(...beginBattle(state, now));
  else state.lastAnnouncement = `${player.name} ready — waiting for opponent fleet.`;

  return { ok: true, effects };
}

function handleCannon(
  state: BattleshipGameState,
  playerId: string,
  data: WireValue,
  now: number,
): GameActionResult {
  const gate = battleTurn(state, playerId);

  if (!gate.ok) return { ok: false, message: gate.error };

  const cell = parseCell(data);

  if (isString(cell)) return { ok: false, message: cell };

  if (shotAt(state, playerId, cell.row, cell.col))
    return { ok: false, message: "Already fired at that cell" };

  const effects: GameEffect[] = [];
  const shot = applyAttack(state, gate.board, gate.opp, cell.row, cell.col, "cannon", effects);

  if (!shot) return { ok: false, message: "Already fired at that cell" };

  const reward = BATTLESHIP_CANNON_POINT_REWARD;

  gate.board.munitionPoints = (gate.board.munitionPoints ?? 0) + reward;
  gate.board.weapons = maxUsesFromPoints(gate.board.munitionPoints);

  const pts = gate.board.munitionPoints;

  let announcement: string;

  if (shot.sunkShipId) {
    announcement = `Shot: you sunk their ${shipName(shot.sunkShipId)}! (${pts} pts) — fire again!`;
  } else if (shot.hit) {
    announcement = `Hit! (${pts} pts) — fire again!`;
  } else {
    announcement = `Miss. (${pts} pts) Turn over.`;
  }

  effects.push({
    type: "event",
    event: "cannon",
    data: {
      playerId,
      row: cell.row,
      col: cell.col,
      hit: shot.hit,
      sunkShipId: shot.sunkShipId,
      reward,
      munitionPoints: pts,
      keepTurn: shot.hit,
    },
  });

  return {
    ok: true,
    effects: [
      ...effects,
      ...finishAttackTurn(
        state,
        playerId,
        gate.opp,
        [shot],
        announcement,
        now,
        shot.hit,
      ),
    ],
  };
}

function handleMine(
  state: BattleshipGameState,
  playerId: string,
  data: WireValue,
  now: number,
): GameActionResult {
  const gate = battleTurn(state, playerId);

  if (!gate.ok) return { ok: false, message: gate.error };

  const cell = parseCell(data);

  if (isString(cell)) return { ok: false, message: cell };

  if (gate.board.cells[cell.row]![cell.col] !== null || shotAt(state, gate.opp.playerId, cell.row, cell.col))
    return { ok: false, message: "Place mines on empty, unattacked water on your own board" };

  if (gate.board.mines?.some((m) => m.row === cell.row && m.col === cell.col))
    return { ok: false, message: "There is already a mine here" };

  const error = spendMunitions(gate.board, "mine");

  if (error) return { ok: false, message: error };

  (gate.board.mines ??= []).push(cell);

  const player = state.players.find((p) => p.id === playerId);

  // Do not include hidden mine coordinates in public events or announcements.
  return {
    ok: true,
    effects: finishAbility(
      state,
      playerId,
      gate.opp,
      [],
      `${player?.name} placed a mine. Cannon still available.`,
      now,
    ),
  };
}

function handleRadar(
  state: BattleshipGameState,
  playerId: string,
  data: WireValue,
  now: number,
): GameActionResult {
  const gate = battleTurn(state, playerId);

  if (!gate.ok) return { ok: false, message: gate.error };

  const err = spendMunitions(gate.board, "radar");

  if (err) return { ok: false, message: err };

  const cell = parseCell(data);

  if (isString(cell)) {
    refundMunitions(gate.board, "radar");

    return { ok: false, message: cell };
  }

  let shipCells = 0;
  let cellsScanned = 0;

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const row = cell.row + dr;
      const col = cell.col + dc;

      if (row < 0 || row >= BATTLESHIP_SIZE || col < 0 || col >= BATTLESHIP_SIZE) continue;
      cellsScanned++;

      if (gate.opp.cells[row]![col] !== null) shipCells++;
    }
  }

  const remaining = gate.board.munitionPoints;
  const cost = BATTLESHIP_WEAPON_COSTS.radar;

  const announcement =
    shipCells > 0
      ? `Radar contact: ${shipCells} ship cell(s) in the 3×3. (−${cost} pt · ${remaining} left)`
      : `Radar clear — no ships in the 3×3. (−${cost} pt · ${remaining} left)`;

  const scan = { row: cell.row, col: cell.col, shipCells, cellsScanned };

  (gate.board.radarScans ??= []).push(scan);
  (gate.opp.receivedRadarScans ??= []).push(scan);

  return {
    ok: true,
    effects: [
      {
        type: "event",
        event: "radar",
        data: {
          playerId,
          row: cell.row,
          col: cell.col,
          shipCells,
          cellsScanned,
          contact: shipCells > 0,
          cost,
          munitionPoints: remaining,
        },
      },
      // Info-only: no shot pegs; the normal shot remains available.
      ...finishAbility(state, playerId, gate.opp, [], announcement, now),
    ],
  };
}

function handleBomb(
  state: BattleshipGameState,
  playerId: string,
  data: WireValue,
  now: number,
): GameActionResult {
  const gate = battleTurn(state, playerId);

  if (!gate.ok) return { ok: false, message: gate.error };

  const err = spendMunitions(gate.board, "bomb");

  if (err) return { ok: false, message: err };

  const cell = parseCell(data);

  if (isString(cell)) {
    refundMunitions(gate.board, "bomb");

    return { ok: false, message: cell };
  }

  // 2×2 with (row,col) as top-left
  if (cell.row > BATTLESHIP_SIZE - 2 || cell.col > BATTLESHIP_SIZE - 2) {
    refundMunitions(gate.board, "bomb");

    return {
      ok: false,
      message: "Bomb needs a 2×2 zone; row and col must each be 0–8",
    };
  }

  const salvoId = randomId();
  const triggeredMinesBefore = gate.opp.triggeredMines?.length ?? 0;
  const effects: GameEffect[] = [];
  const shots: BattleShot[] = [];
  const sunk: ShipId[] = [];
  let hits = 0;
  let misses = 0;

  for (let dr = 0; dr <= 1; dr++) {
    for (let dc = 0; dc <= 1; dc++) {
      const row = cell.row + dr;
      const col = cell.col + dc;

      const shot = applyAttack(state, gate.board, gate.opp, row, col, "bomb", effects, salvoId);

      if (!shot) continue;
      shots.push(shot);

      if (shot.hit) hits++;
      else misses++;

      if (shot.sunkShipId) sunk.push(shot.sunkShipId);
    }
  }

  if (shots.length === 0) {
    refundMunitions(gate.board, "bomb");

    return { ok: false, message: "All cells in that 2×2 already attacked" };
  }

  const remaining = gate.board.munitionPoints;
  const minesTriggered = (gate.opp.triggeredMines?.length ?? 0) - triggeredMinesBefore;

  (gate.opp.bombedAreas ??= []).push({ row: cell.row, col: cell.col });

  const cost = BATTLESHIP_WEAPON_COSTS.bomb;
  let announcement = `Bomb (−${cost} pt): ${hits} hit(s), ${misses} miss(es). ${remaining} pts left.`;

  if (sunk.length) announcement += ` Sunk: ${sunk.map(shipName).join(", ")}!`;

  if (minesTriggered > 0) announcement += " Mine triggered. Turn over.";

  effects.push({
    type: "event",
    event: "bomb",
    data: {
      playerId,
      row: cell.row,
      col: cell.col,
      hits,
      misses,
      sunk,
      minesTriggered,
      cost,
      munitionPoints: remaining,
    },
  });

  return {
    ok: true,
    effects:
      minesTriggered > 0
        ? [...effects, ...finishAttackTurn(state, playerId, gate.opp, shots, announcement, now)]
        : [...effects, ...finishAbility(state, playerId, gate.opp, shots, announcement, now)],
  };
}

function handleTorpedo(
  state: BattleshipGameState,
  playerId: string,
  data: WireValue,
  now: number,
): GameActionResult {
  const gate = battleTurn(state, playerId);

  if (!gate.ok) return { ok: false, message: gate.error };

  const err = spendMunitions(gate.board, "torpedo");

  if (err) return { ok: false, message: err };

  const cell = parseCell(data);

  if (isString(cell)) {
    refundMunitions(gate.board, "torpedo");

    return { ok: false, message: cell };
  }

  const requestedDirection = isWireObject(data) ? (data.direction ?? data.dir) : undefined;

  const resolved = resolveTorpedoDirection(
    cell.row,
    cell.col,
    isString(requestedDirection) ? requestedDirection : null,
    BATTLESHIP_SIZE,
  );

  if ("error" in resolved) {
    refundMunitions(gate.board, "torpedo");

    return { ok: false, message: resolved.error };
  }

  const direction = resolved.direction;
  const delta = TORPEDO_DELTAS[direction];
  const salvoId = randomId();
  const effects: GameEffect[] = [];
  const shots: BattleShot[] = [];
  const sunk: ShipId[] = [];
  let hits = 0;
  let misses = 0;

  let endRow = cell.row;
  let endCol = cell.col;

  // Travel the full line until first ship hit (or board edge)
  for (let i = 0; i < BATTLESHIP_SIZE; i++) {
    const row = cell.row + delta.dr * i;
    const col = cell.col + delta.dc * i;

    if (row < 0 || row >= BATTLESHIP_SIZE || col < 0 || col >= BATTLESHIP_SIZE) break;
    endRow = row;
    endCol = col;

    const occupied = gate.opp.cells[row]![col] !== null;

    if (shotAt(state, playerId, row, col)) {
      // Past water already marked; stop if this was already a hit on a ship
      if (occupied) {
        const prior = state.shots.find(
          (s) => s.byPlayerId === playerId && s.row === row && s.col === col && s.hit,
        );

        if (prior) break;
      }

      continue;
    }

    const shot = applyAttack(state, gate.board, gate.opp, row, col, "torpedo", effects, salvoId);

    if (!shot) continue;
    shots.push(shot);

    if (shot.hit) {
      hits++;

      if (shot.sunkShipId) sunk.push(shot.sunkShipId);
      break; // stop on first ship hit
    }

    misses++;
  }

  if (shots.length === 0) {
    refundMunitions(gate.board, "torpedo");

    return { ok: false, message: "Torpedo path already fully attacked or out of bounds" };
  }

  const remaining = gate.board.munitionPoints;

  (gate.opp.torpedoPaths ??= []).push({ ...cell, endRow, endCol, direction });

  const cost = BATTLESHIP_WEAPON_COSTS.torpedo;
  let announcement = `Torpedo (−${cost} pt): ${hits} hit(s), ${misses} miss(es). ${remaining} pts left.`;

  if (sunk.length) announcement += ` Sunk: ${sunk.map(shipName).join(", ")}!`;

  effects.push({
    type: "event",
    event: "torpedo",
    data: {
      playerId,
      row: cell.row,
      col: cell.col,
      direction,
      hits,
      misses,
      sunk,
      cost,
      munitionPoints: remaining,
    },
  });

  return {
    ok: true,
    effects: [...effects, ...finishAbility(state, playerId, gate.opp, shots, announcement, now)],
  };
}

/** Route one intent to its handler. */
export function applyAction(
  state: BattleshipGameState,
  playerId: string,
  intent: GameIntent,
  now: number,
): GameActionResult {
  switch (intent.actionType) {
    case "place_fleet":
    case "place_ships":
      return handlePlace(state, playerId, intent.data, now);
    case "cannon":
    case "fire":
    case "shoot":
      return handleCannon(state, playerId, intent.data, now);
    case "mine":
      return handleMine(state, playerId, intent.data, now);
    case "radar":
      return handleRadar(state, playerId, intent.data, now);
    case "bomb":
      return handleBomb(state, playerId, intent.data, now);
    case "torpedo":
      return handleTorpedo(state, playerId, intent.data, now);
    default:
      return { ok: false, message: `Unknown action: ${intent.actionType}` };
  }
}

/**
 * Turn-timeout policy.
 *
 * In battle the turn passes and the opponent collects the start-of-turn energy.
 * In placement every unfinished fleet is auto-deployed and the battle begins, so
 * a captain who never shows up cannot stall the match.
 */
export function onTurnTimeout(
  state: BattleshipGameState,
  now: number,
): GameEffect[] {
  if (state.turnState.phase === "battle") {
    const currentIndex = state.players.findIndex(
      (p) => p.id === state.turnState.currentPlayerId,
    );

    const next = state.players[(currentIndex + 1) % state.players.length];

    if (!next) return [];

    state.turnState.currentPlayerId = next.id;
    state.turnState.turnTimeRemaining = state.timerConfig.turnTime;
    state.turnState.startedAt = now;
    state.turnState.turnNumber++;
    awardTurnPoints(state, next.id);

    return [
      {
        type: "event",
        event: "turn_changed",
        data: {
          currentPlayerId: state.turnState.currentPlayerId,
          turnNumber: state.turnState.turnNumber,
          phase: state.turnState.phase,
        },
      },
    ];
  }

  if (state.turnState.phase !== "placement") return [];

  const effects: GameEffect[] = [];
  const autoPlacedPlayerIds: string[] = [];

  for (const board of state.boards) {
    if (board.ready) continue;

    const fleet = randomFleet();

    board.ships = fleet.ships;
    board.cells = fleet.cells;
    board.ready = true;
    board.munitionPoints = BATTLESHIP_STARTING_MUNITION_POINTS;
    board.weapons = maxUsesFromPoints(board.munitionPoints);
    autoPlacedPlayerIds.push(board.playerId);
    effects.push({ type: "event", event: "fleet_auto_placed", data: { playerId: board.playerId } });
  }

  effects.push(
    ...beginBattle(state, now, "Placement time expired — missing fleets auto-deployed."),
  );
  effects.push({
    type: "event",
    event: "placement_timeout",
    data: { autoPlacedPlayerIds },
  });

  return effects;
}

/** Exported for the room adapter, which draws the first player through it. */
export { firstPlayerIndex };
