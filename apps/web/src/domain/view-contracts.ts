import { z } from "zod";

export const pointSchema = z.object({
  row: z.number(),
  col: z.number(),
  weapon: z.string().optional(),
  sunkShipId: z.string().optional(),
});

export const numericBoardSchema = z.array(z.array(z.number()));

export const wordBoardSchema = z.array(
  z.object({
    index: z.number(),
    word: z.string(),
    revealed: z.boolean(),
    affiliation: z.string().nullable().optional(),
  }),
);

export const clueSchema = z
  .object({
    word: z.string(),
    count: z.union([z.number(), z.string()]),
    givenBy: z.string().optional(),
  })
  .nullable();

export const remainingSchema = z.object({ red: z.number(), blue: z.number() });

export const assignmentSchema = z.record(
  z.string(),
  z.object({ team: z.enum(["red", "blue"]), role: z.enum(["spymaster", "operative"]) }),
);

export const lastMoveSchema = pointSchema
  .partial()
  .extend({
    fromRow: z.number().optional(),
    fromCol: z.number().optional(),
    capture: pointSchema.nullable().optional(),
    crowned: z.boolean().optional(),
    playerId: z.string().optional(),
  })
  .nullable();

export const discMovesSchema = z.array(pointSchema.extend({ flipCount: z.number().optional() }));

export const checkerMovesSchema = z.array(
  pointSchema.extend({ fromRow: z.number(), fromCol: z.number(), capture: pointSchema.nullable() }),
);

export const cardSchema = z.object({
  rank: z.string(),
  suit: z.string(),
  hidden: z.boolean().optional(),
});

export const cardsSchema = z.array(cardSchema);

export const cardSeatsSchema = z.array(
  z.object({
    playerId: z.string(),
    name: z.string(),
    stack: z.number().optional(),
    streetBet: z.number().optional(),
    chips: z.number().optional(),
    hole: cardsSchema.optional(),
    folded: z.boolean().optional(),
    allIn: z.boolean().optional(),
    status: z.string().optional(),
  }),
);

export const seatNumbersSchema = z.record(z.string(), z.number());

export const shotSchema = pointSchema.extend({
  sequence: z.number().optional(),
  hit: z.boolean(),
  sunkShipId: z.string().optional(),
  byPlayerId: z.string(),
  weapon: z.string().optional(),
});

export const shotsSchema = z.array(shotSchema);

export const radarSchema = pointSchema.extend({ shipCells: z.number(), cellsScanned: z.number() });

export const shipSchema = pointSchema.extend({
  id: z.string(),
  rotation: z.number().optional(),
  sunk: z.boolean().optional(),
  "shape": z.array(z.object({ dr: z.number(), dc: z.number() })).optional(),
  cells: z.array(pointSchema).optional(),
});

export const seaSchema = z.object({
  playerId: z.string().optional(),
  ready: z.boolean().optional(),
  cells: z.array(z.array(z.string().nullable())).optional(),
  ships: z.array(shipSchema.extend({ rotation: z.number() })).optional(),
  revealedShips: z.array(shipSchema.extend({ rotation: z.number() })).optional(),
  sunkShips: z.array(shipSchema.extend({ rotation: z.number() })).optional(),
  fleetStatus: z.array(z.object({ id: z.string(), sunk: z.boolean().optional() })).optional(),
  incomingHits: z.array(pointSchema).optional(),
  incomingMisses: z.array(pointSchema).optional(),
  hits: z.array(pointSchema).optional(),
  misses: z.array(pointSchema).optional(),
  shipsRemaining: z.number().optional(),
  munitionPoints: z.number().optional(),
  radarScans: z.array(radarSchema).optional(),
  torpedoPaths: z
    .array(
      pointSchema.extend({
        endRow: z.number(),
        endCol: z.number(),
        direction: z.enum(["n", "s", "e", "w"]),
      }),
    )
    .optional(),
  mineShots: z.array(pointSchema).optional(),
  mineHits: z.array(pointSchema).optional(),
  triggeredMines: z.array(pointSchema).optional(),
  bombedAreas: z.array(pointSchema).optional(),
  mines: z.array(pointSchema).optional(),
  revealedMines: z.array(pointSchema).optional(),
});

export const seasSchema = z.array(seaSchema);

export const statNamesSchema = z.enum(["hp", "atk", "def", "spa", "spd", "spe"]);

export const monsterSchema = z.object({
  hidden: z.boolean().optional(),
  slot: z.number().optional(),
  name: z.string().optional(),
  species: z.string().optional(),
  sprite: z.string().optional(),
  level: z.number().optional(),
  active: z.boolean().optional(),
  fainted: z.boolean().optional(),
  condition: z.string().optional(),
  types: z.array(z.string()).optional(),
  moves: z.array(z.object({ name: z.string(), pp: z.number(), maxpp: z.number() })).optional(),
  revealedMoves: z.array(z.string()).optional(),
  effects: z.array(z.string()).optional(),
  stats: z.partialRecord(statNamesSchema, z.number()).optional(),
  boosts: z
    .partialRecord(z.enum(["atk", "def", "spa", "spd", "spe", "accuracy", "evasion"]), z.number())
    .optional(),
});

export const pokemonSidesSchema = z.array(
  z.object({ seat: z.string(), pokemon: z.array(monsterSchema) }),
);

export const pokemonMoveSchema = z.object({
  slot: z.number(),
  name: z.string(),
  type: z.string().optional(),
  pp: z.number().optional(),
  maxpp: z.number().optional(),
  disabled: z.boolean().optional(),
  power: z.number().optional(),
  accuracy: z.union([z.number(), z.boolean()]).optional(),
  description: z.string().optional(),
  fullDescription: z.string().optional(),
  category: z.string().optional(),
  priority: z.number().optional(),
  sameTypeBonus: z.boolean().optional(),
  typeMatchup: z.number().optional(),
  matchupTarget: z.string().optional(),
  damage: z.string().optional(),
});

export const pokemonDecisionSchema = z
  .object({
    forceSwitch: z.boolean(),
    moves: z.array(pokemonMoveSchema),
    switches: z.array(z.object({ slot: z.number(), name: z.string() })),
  })
  .nullable();

export const ownGuessSchema = z.object({
  word: z.string(),
  submittedWord: z.string().optional(),
  rank: z.number(),
  sequence: z.number(),
});

export const maskedGuessSchema = z.object({ rank: z.number(), masked: z.literal(true) });

export const guessAttemptSchema = z.object({
  submittedWord: z.string(),
  canonicalWord: z.string().optional(),
  status: z.enum(["ranked", "aliased", "not_in_pool"]),
  rank: z.number().optional(),
});

export const contextoProgressSchema = z.record(
  z.string(),
  z.object({
    playerId: z.string(),
    guesses: z.array(z.union([ownGuessSchema, maskedGuessSchema])),
    lastAttempt: guessAttemptSchema.nullable().optional(),
    guessCount: z.number(),
    guessesRemaining: z.number(),
    bestRank: z.number().nullable(),
    exhausted: z.boolean(),
  }),
);

/** Known entries stay inferred; arbitrary lookup keys are checked before access. */
export function knownValue<T extends object>(
  values: T,
  key: string | number,
): T[keyof T] | undefined {
  if (!hasKnownKey(values, key)) return undefined;

  return values[key];
}

export function hasKnownKey<T extends object>(
  values: T,
  key: string | number,
): key is keyof T & (string | number) {
  return Object.hasOwn(values, key);
}

export function isNumericBoard<T>(value: T): value is T & number[][] {
  return numericBoardSchema.safeParse(value).success;
}

export function isWordBoard<T>(value: T): value is T & z.output<typeof wordBoardSchema> {
  return wordBoardSchema.safeParse(value).success;
}
