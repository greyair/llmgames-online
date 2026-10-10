import { isObject, isString, wireObjectSchema, type WireObject } from "@llmgames/game-catalog";

/** A second, explicit allowlist after each game's public broadcast projection. */
type Json = import("@llmgames/game-catalog").WireValue;

type FieldSelection =
  | true
  | readonly [FieldSelection]
  | { readonly [field: string]: FieldSelection };

const card = { rank: true, suit: true, hidden: true } as const;

const point = { row: true, col: true } as const;

const shipFieldSelection = { dr: true, dc: true } as const;

const fleetSpec = {
  id: true,
  name: true,
  shortName: true,
  length: true,
  "shape": [shipFieldSelection],
} as const;

const fields = {
  type: true,
  status: true,
  gameTimeRemaining: true,
  maxPlayers: true,
  timerConfig: { turnTime: true, gameTotalTime: true },
  turnState: { currentPlayerId: true, turnNumber: true, phase: true, turnTimeRemaining: true },
  players: [
    {
      id: true,
      name: true,
      isAgent: true,
      channel: true,
      codename: true,
      spectatorIdentity: true,
      ownerGamertag: true,
      environmentLabel: true,
    },
  ],
  seats: [
    {
      playerId: true,
      name: true,
      stack: true,
      status: true,
      streetBet: true,
      folded: true,
      allIn: true,
      hole: [card],
    },
  ],
  community: [card],
  pot: true,
  handNumber: true,
  battleTurn: true,
  battleLog: [true],
  battleLogOffset: true,
  sides: [
    {
      seat: true,
      pokemon: [
        {
          hidden: true,
          name: true,
          species: true,
          sprite: true,
          level: true,
          active: true,
          fainted: true,
          condition: true,
          effects: [true],
          boosts: {
            atk: true,
            def: true,
            spa: true,
            spd: true,
            spe: true,
            accuracy: true,
            evasion: true,
          },
          types: [true],
          revealedMoves: [true],
        },
      ],
    },
  ],
  winner: true,
  winnerTeam: true,
  lastAnnouncement: true,
  shotLog: [
    {
      sequence: true,
      row: true,
      col: true,
      hit: true,
      sunkShipId: true,
      byPlayerId: true,
      weapon: true,
      salvoId: true,
    },
  ],
  lastMove: {
    row: true,
    col: true,
    fromRow: true,
    fromCol: true,
    capture: point,
    crowned: true,
    seat: true,
    flipped: [point],
  },
  forcedPiece: point,
  lastPass: { playerId: true, turn: true },
  lastHandResult: { winners: [true], reason: true, showdown: true, pot: true },
  scores: { "1": true, "2": true },
  activeTeam: true,
  clue: { word: true, count: true },
  remaining: { red: true, blue: true },
  fleet: [fleetSpec],
  guessLimit: true,
  vocabularySize: true,
  totalGuesses: true,
  secret: true,
  spectatorBoards: [
    {
      playerId: true,
      ready: true,
      hits: [point],
      misses: [point],
      shipsRemaining: true,
      munitionPoints: true,
      fleetStatus: [{ ...fleetSpec, sunk: true }],
      sunkShips: [{ ...fleetSpec, row: true, col: true, rotation: true }],
    },
  ],
} as const satisfies FieldSelection;

function pick(value: Json | undefined, selection: FieldSelection): Json | undefined {
  if (value === undefined) return undefined;

  if (value === null) return null;

  if (selection === true) return isObject(value) ? undefined : value;

  if (Array.isArray(selection)) {
    return Array.isArray(value) ? value.map((v) => pick(v, selection[0]!) ?? null) : undefined;
  }

  if (!isObject(value) || Array.isArray(value)) return undefined;
  const result: { [field: string]: Json } = {};

  for (const [key, child] of Object.entries(selection)) {
    const selected = pick(value[key], child);

    if (selected !== undefined) result[key] = selected;
  }

  return result;
}

export function broadcastProjection<T>(
  projected: T,
  members: readonly { id: string; name: string }[],
) {
  const source = wireObjectSchema.parse(JSON.parse(JSON.stringify(projected)));
  const publicNames = new Map(members.map((member) => [member.id, member.name]));
  const label = (value: Json | undefined): string => (isString(value) ? value.trim() : "");

  if (Array.isArray(source.players))
    source.players = source.players.map((player) => {
      if (!player || !isObject(player) || Array.isArray(player)) return player;
      const isAgent = player.isAgent === true || player.channel === "mcp";

      const name =
        (isAgent ? label(player.codename) : label(player.ownerGamertag)) ||
        label(player.name) ||
        publicNames.get(String(player.id)) ||
        "Player";

      publicNames.set(String(player.id), name);

      const identity: WireObject = {
        id: player.id ?? "",
        name,
        isAgent,
        spectatorIdentity: true,
      };

      if (isAgent) {
        identity.codename = name;
        identity.ownerGamertag = label(player.ownerGamertag);
        identity.environmentLabel = label(player.environmentLabel);
      }

      return identity;
    });

  if (Array.isArray(source.seats))
    source.seats = source.seats.map((seat) => {
      if (!seat || !isObject(seat) || Array.isArray(seat)) return seat;

      return { ...seat, name: publicNames.get(String(seat.playerId)) ?? "Player" };
    });

  // Engine log messages can contain the original trainer names.
  if (Array.isArray(source.battleLog))
    source.battleLog = source.battleLog.map((line) => {
      if (!isString(line)) return line;

      for (const member of members)
        if (member.name) line = line.split(member.name).join(publicNames.get(member.id)!);

      return line;
    });

  if (isString(source.lastAnnouncement)) {
    for (const member of members)
      if (member.name)
        source.lastAnnouncement = source.lastAnnouncement
          .split(member.name)
          .join(publicNames.get(member.id)!);
  }

  const result = wireObjectSchema.parse(pick(source, fields));
  const ids = new Map(members.map((p, index) => [p.id, `seat-${index + 1}`]));

  // Strip account IDs even from cross-references. Only allowlisted public labels survive.
  const remap = (value: Json): Json => {
    if (isString(value)) return ids.get(value) ?? value;

    if (Array.isArray(value)) return value.map(remap);

    if (value && isObject(value))
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v)]));

    return value;
  };

  if (source.type === "connect4" || source.type === "reversi" || source.type === "checkers") {
    result.board = pick(source.board, [[true]]) ?? [];
    const seats = source.seats;

    if (source.type === "checkers" && seats && !Array.isArray(seats) && isObject(seats)) {
      result.seats = Object.fromEntries(
        members.map((p) => [ids.get(p.id)!, seats[p.id] === 1 ? 1 : seats[p.id] === 2 ? 2 : null]),
      );
    }

    result.discSeats = members.map((p) => ({
      playerId: ids.get(p.id)!,
      disc: seats && !Array.isArray(seats) && isObject(seats) ? (seats[p.id] ?? null) : null,
    }));
  } else if (source.type === "codenames") {
    result.board =
      pick(source.board, [{ index: true, word: true, revealed: true, affiliation: true }]) ?? [];
    result.activityLog =
      pick(source.activityLog, [
        {
          at: true,
          type: true,
          team: true,
          playerId: true,
          word: true,
          count: true,
          affiliation: true,
          reason: true,
          winner: true,
        },
      ]) ?? [];
    result.guessesRemaining = pick(source.guessesRemaining, true) ?? null;
    const assignments = source.assignments;

    if (assignments && isObject(assignments) && !Array.isArray(assignments)) {
      result.assignments = Object.fromEntries(
        members.flatMap((member) => {
          const assignment = pick(assignments[member.id], { team: true, role: true });

          return assignment ? [[ids.get(member.id)!, assignment]] : [];
        }),
      );
    }
  } else if (source.type === "contexto") {
    const progress = source.progress;
    result.progress = Object.fromEntries(
      members.map((member) => {
        const entry =
          progress && isObject(progress) && !Array.isArray(progress)
            ? progress[member.id]
            : undefined;

        return [
          ids.get(member.id)!,
          pick(entry, {
            playerId: true,
            guesses: [{ word: true, rank: true, sequence: true }],
            guessCount: true,
            guessesRemaining: true,
            bestRank: true,
            exhausted: true,
          }) ?? null,
        ];
      }),
    );
  }

  return wireObjectSchema.parse(remap(result));
}
