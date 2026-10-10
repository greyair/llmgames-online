import {
  pokemonSidesSchema,
  pokemonDecisionSchema,
  lastMoveSchema,
  assignmentSchema,
  clueSchema,
  remainingSchema,
  cardsSchema,
  seaSchema,
  seasSchema,
  shotsSchema,
  contextoProgressSchema,
  numericBoardSchema,
  wordBoardSchema,
  seatNumbersSchema,
  cardSeatsSchema,
  discMovesSchema,
  checkerMovesSchema,
} from "./view-contracts";
import { z } from "zod";
import { wireValueSchema, type WireValue } from "@llmgames/game-catalog";
import type { GamePlayer } from "../features/shared/gameOverCopy";

const viewerRoleSchema = z.enum([
  "player1",
  "player2",
  "black",
  "white",
  "player",
  "captain",
  "spymaster",
  "operative",
  "spectator",
]);

export type ClientView = {
  jev?: {
    available: boolean;
    playerId?: string;
    status: "ready" | "thinking" | "retrying" | "unavailable" | "limit_reached";
  };
  yourSeat?: "p1" | "p2" | null;
  battleSeats?: Record<string, "p1" | "p2">;
  sides?: z.output<typeof pokemonSidesSchema>;
  decision?: z.output<typeof pokemonDecisionSchema>;
  battleTurn?: number;
  battleLog?: string[];
  battleLogOffset?: number;
  /** Browser-only marker for server snapshots rendered without live controls. */
  replayReadOnly?: boolean;
  /** Public operator stream. Its server projection may include stream-only fields. */
  broadcastPublic?: boolean;
  /** Neutral replay orientation. This player is never presented as the viewer. */
  replayPerspectivePlayerId?: string;
  fleet?: {
    id: string;
    name: string;
    shortName?: string;
    length?: number;
    "shape": { dr: number; dc: number }[];
  }[];
  type?: string;
  status?: string;
  roomCode?: string;
  players?: GamePlayer[];
  hostId?: string;
  turnState?: {
    currentPlayerId: string | null;
    phase: string;
    turnNumber: number;
    startedAt?: number;
    turnTimeRemaining?: number;
  };
  timerConfig?: {
    gameTotalTime?: number;
    turnTime?: number;
  };
  gameTimeRemaining?: number;
  clock?: { serverTime: number; gameEndsAt: number | null; turnEndsAt: number | null };
  /** Monotonic browser receipt time; never supplied by the server. */
  clockReceivedAt?: number;
  expiresAt?: number;
  you?: {
    playerId?: string;
    isHost?: boolean;
    isYourTurn?: boolean;
    isSpectator?: boolean;
    phase?: string;
    legalActions?: string[];
    seat?: number | null;
    munitionPoints?: number;
    stack?: number | null;
    toCall?: number;
    weaponCosts?: { bomb?: number; radar?: number; torpedo?: number };
    team?: "red" | "blue" | null;
    role?: z.output<typeof viewerRoleSchema> | null;
    canSeeKey?: boolean;
  };
  spectators?: GamePlayer[];
  spectatorCount?: number;
  winner?: string | null;
  actionLog?: Array<{
    playerId: string;
    action: string;
    amount?: number;
    street: string;
    handNumber: number;
  }>;
  lastHandResult?: {
    winners?: string[];
    showdown?: boolean;
    reason?: string;
    pot?: number;
    finishedAt?: number;
    hands?: Array<{
      playerId: string;
      label: string;
      hole?: Array<{ rank: string; suit: string }>;
    }>;
    payouts?: Array<{ playerId: string; amount: number }>;
  } | null;
  maxPlayers?: number;
  board?: z.output<typeof numericBoardSchema> | z.output<typeof wordBoardSchema>;
  seats?: z.output<typeof seatNumbersSchema> | z.output<typeof cardSeatsSchema>;
  lastMove?: z.output<typeof lastMoveSchema>;
  scores?: Partial<Record<1 | 2, number>>;
  legalMoves?: z.output<typeof discMovesSchema> | z.output<typeof checkerMovesSchema>;
  forcedPiece?: { row: number; col: number } | null;
  lastPass?: WireValue;
  assignments?: z.output<typeof assignmentSchema>;
  startingTeam?: "red" | "blue";
  activeTeam?: "red" | "blue";
  clue?: z.output<typeof clueSchema>;
  guessesRemaining?: number | null;
  guessesMade?: number;
  remaining?: z.output<typeof remainingSchema>;
  winnerTeam?: "red" | "blue" | null;
  activityLog?: WireValue;
  lastReveal?: WireValue;
  currentBet?: number;
  minRaise?: number;
  handNumber?: number;
  community?: z.output<typeof cardsSchema>;
  pot?: number;
  toCall?: number;
  blinds?: { sb?: number; bb?: number };
  bigBlind?: number;
  buttonPlayerId?: string | null;
  smallBlindPlayerId?: string | null;
  bigBlindPlayerId?: string | null;
  lastAnnouncement?: string | null;
  radarScans?: Array<{ row: number; col: number; shipCells: number; cellsScanned: number }>;
  munitionEconomy?: {
    turnReward?: number;
    hitReward?: number;
    costs?: { mine?: number; bomb?: number; radar?: number; torpedo?: number };
  };
  opponent?: z.output<typeof seaSchema> | null;
  spectatorBoards?: z.output<typeof seasSchema>;
  stats?: WireValue;
  shotLog?: z.output<typeof shotsSchema>;
  yourBoard?: z.output<typeof seaSchema> | null;
  randomness?: WireValue;
  guessLimit?: number;
  vocabularySize?: number;
  totalGuesses?: number;
  progress?: z.output<typeof contextoProgressSchema>;
  secret?: string;
};

const gamePlayerSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable().optional(),
    isAgent: z.boolean().optional(),
    channel: z.string().nullable().optional(),
    codename: z.string().nullable().optional(),
    ownerGamertag: z.string().nullable().optional(),
    environmentLabel: z.string().nullable().optional(),
  })
  .catchall(wireValueSchema);

const clientViewContract = z
  .object({
    "jev": z
      .object({
        "available": z.boolean(),
        "playerId": z.string().optional(),
        "status": z.union([
          z.literal("ready"),
          z.literal("thinking"),
          z.literal("retrying"),
          z.literal("unavailable"),
          z.literal("limit_reached"),
        ]),
      })
      .optional(),
    "yourSeat": z.union([z.literal("p1"), z.literal("p2"), z.null()]).optional(),
    "battleSeats": z.record(z.string(), z.union([z.literal("p1"), z.literal("p2")])).optional(),
    "sides": pokemonSidesSchema.optional(),
    "decision": pokemonDecisionSchema.optional(),
    "battleTurn": z.number().optional(),
    "battleLog": z.array(z.string()).optional(),
    "battleLogOffset": z.number().optional(),
    "replayReadOnly": z.boolean().optional(),
    "broadcastPublic": z.boolean().optional(),
    "replayPerspectivePlayerId": z.string().optional(),
    "fleet": z
      .array(
        z.object({
          "id": z.string(),
          "name": z.string(),
          "shortName": z.string().optional(),
          "length": z.number().optional(),
          "shape": z.array(z.object({ "dr": z.number(), "dc": z.number() })),
        }),
      )
      .optional(),
    "type": z.string().optional(),
    "status": z.string().optional(),
    "roomCode": z.string().optional(),
    "players": z.array(gamePlayerSchema).optional(),
    "hostId": z.string().optional(),
    "turnState": z
      .object({
        "currentPlayerId": z.union([z.string(), z.null()]),
        "phase": z.string(),
        "turnNumber": z.number(),
        "startedAt": z.number().optional(),
        "turnTimeRemaining": z.number().optional(),
      })
      .optional(),
    "timerConfig": z
      .object({ "gameTotalTime": z.number().optional(), "turnTime": z.number().optional() })
      .optional(),
    "gameTimeRemaining": z.number().optional(),
    "clock": z
      .object({
        "serverTime": z.number(),
        "gameEndsAt": z.union([z.number(), z.null()]),
        "turnEndsAt": z.union([z.number(), z.null()]),
      })
      .optional(),
    "clockReceivedAt": z.number().optional(),
    "expiresAt": z.number().optional(),
    "you": z
      .object({
        "playerId": z.string().optional(),
        "isHost": z.boolean().optional(),
        "isYourTurn": z.boolean().optional(),
        "isSpectator": z.boolean().optional(),
        "phase": z.string().optional(),
        "legalActions": z.array(z.string()).optional(),
        "seat": z.union([z.number(), z.null()]).optional(),
        "munitionPoints": z.number().optional(),
        "stack": z.union([z.number(), z.null()]).optional(),
        "toCall": z.number().optional(),
        "weaponCosts": z
          .object({
            "bomb": z.number().optional(),
            "radar": z.number().optional(),
            "torpedo": z.number().optional(),
          })
          .optional(),
        "team": z.union([z.literal("red"), z.literal("blue"), z.null()]).optional(),
        "role": viewerRoleSchema.nullable().optional(),
        "canSeeKey": z.boolean().optional(),
      })
      .optional(),
    "spectators": z.array(gamePlayerSchema).optional(),
    "spectatorCount": z.number().optional(),
    "winner": z.union([z.string(), z.null()]).optional(),
    "actionLog": z
      .array(
        z.object({
          "playerId": z.string(),
          "action": z.string(),
          "amount": z.number().optional(),
          "street": z.string(),
          "handNumber": z.number(),
        }),
      )
      .optional(),
    "lastHandResult": z
      .union([
        z.object({
          "winners": z.array(z.string()).optional(),
          "showdown": z.boolean().optional(),
          "reason": z.string().optional(),
          "pot": z.number().optional(),
          "finishedAt": z.number().optional(),
          "hands": z
            .array(
              z.object({
                "playerId": z.string(),
                "label": z.string(),
                "hole": z.array(z.object({ "rank": z.string(), "suit": z.string() })).optional(),
              }),
            )
            .optional(),
          "payouts": z.array(z.object({ "playerId": z.string(), "amount": z.number() })).optional(),
        }),
        z.null(),
      ])
      .optional(),
    "maxPlayers": z.number().optional(),
    "board": z.union([numericBoardSchema, wordBoardSchema]).optional(),
    "seats": z.union([seatNumbersSchema, cardSeatsSchema]).optional(),
    "lastMove": lastMoveSchema.optional(),
    "scores": z.object({ "1": z.number().optional(), "2": z.number().optional() }).optional(),
    "legalMoves": z.union([checkerMovesSchema, discMovesSchema]).optional(),
    "forcedPiece": z
      .union([z.object({ "row": z.number(), "col": z.number() }), z.null()])
      .optional(),
    "lastPass": wireValueSchema.optional(),
    "assignments": assignmentSchema.optional(),
    "startingTeam": z.union([z.literal("red"), z.literal("blue")]).optional(),
    "activeTeam": z.union([z.literal("red"), z.literal("blue")]).optional(),
    "clue": clueSchema.optional(),
    "guessesRemaining": z.union([z.number(), z.null()]).optional(),
    "guessesMade": z.number().optional(),
    "remaining": remainingSchema.optional(),
    "winnerTeam": z.union([z.literal("red"), z.literal("blue"), z.null()]).optional(),
    "activityLog": wireValueSchema.optional(),
    "lastReveal": wireValueSchema.optional(),
    "currentBet": z.number().optional(),
    "minRaise": z.number().optional(),
    "handNumber": z.number().optional(),
    "community": cardsSchema.optional(),
    "pot": z.number().optional(),
    "toCall": z.number().optional(),
    "blinds": z.object({ "sb": z.number().optional(), "bb": z.number().optional() }).optional(),
    "bigBlind": z.number().optional(),
    "buttonPlayerId": z.union([z.string(), z.null()]).optional(),
    "smallBlindPlayerId": z.union([z.string(), z.null()]).optional(),
    "bigBlindPlayerId": z.union([z.string(), z.null()]).optional(),
    "lastAnnouncement": z.string().nullable().optional(),
    "radarScans": z
      .array(
        z.object({
          "row": z.number(),
          "col": z.number(),
          "shipCells": z.number(),
          "cellsScanned": z.number(),
        }),
      )
      .optional(),
    "munitionEconomy": z
      .object({
        "turnReward": z.number().optional(),
        "hitReward": z.number().optional(),
        "costs": z
          .object({
            "mine": z.number().optional(),
            "bomb": z.number().optional(),
            "radar": z.number().optional(),
            "torpedo": z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    "opponent": z.union([seaSchema, z.null()]).optional(),
    "spectatorBoards": seasSchema.optional(),
    "stats": wireValueSchema.optional(),
    "shotLog": shotsSchema.optional(),
    "yourBoard": z.union([seaSchema, z.null()]).optional(),
    "randomness": wireValueSchema.optional(),
    "guessLimit": z.number().optional(),
    "vocabularySize": z.number().optional(),
    "totalGuesses": z.number().optional(),
    "progress": contextoProgressSchema.optional(),
    "secret": z.string().optional(),
  })
  .catchall(wireValueSchema) satisfies z.ZodType<ClientView>;

/** Validate the known browser contract while preserving the server's complete projected frame. */
export const clientViewSchema = z.custom<ClientView>(
  (value) => clientViewContract.safeParse(value).success,
);

export function isClientView<T>(value: T): value is T & ClientView {
  return clientViewSchema.safeParse(value).success;
}
