import { z } from "zod";

import type { GameIntent, RuleBotDecisionView, RuleBotStrategy } from "../contract";
import { AEROPLANE_CENTRE, AEROPLANE_HANGAR } from "./board";
import { aeroplaneChoices } from "./rules";

/**
 * Aeroplane chess rule bot (C4).
 *
 * Two decisions per turn: roll, then pick a plane. Both use the game's own rule
 * helpers — `aeroplaneChoices` is the same function the server uses to decide
 * what is legal — so the bot can never propose a move the rules would refuse.
 *
 * Priority when several planes are movable: finish a plane (home), then eat an
 * opponent, then advance the furthest plane, then launch a new one. A launch is
 * last because a plane on the board is worth more than a fresh one in the
 * hangar. The dice stay server-side; the bot only reads the roll it was given.
 */

const planeListSchema = z.array(z.number()).catch([]);

const seatListSchema = z.array(z.array(z.number())).catch([]);

const colourListSchema = z.array(z.number()).catch([]);

/** The bot reads a JSON projection, so every field is parsed before use. */
const viewSchema = z.object({
  seats: z.record(z.string(), z.number()).catch({}),
  planes: seatListSchema,
  colours: colourListSchema,
  takeoff: planeListSchema,
  roll: z.number().nullable().catch(null),
  sixes: z.number().catch(0),
});

export const aeroplaneRuleBot: RuleBotStrategy = {
  id: "aeroplane.greedy.v1",

  chooseAction({ view, legalActions, playerId }: RuleBotDecisionView): GameIntent | null {
    if (legalActions.includes("roll")) return { actionType: "roll", data: {} };

    const parsed = viewSchema.parse(view);

    const seat = parsed.seats[playerId];

    if (seat === undefined) return null;

    const planes = parsed.planes[seat];

    if (!planes) return null;

    const roll = parsed.roll;

    if (roll === null) return null;

    const table = {
      colours: parsed.colours,
      planes: parsed.planes,
      takeoff: parsed.takeoff,
      roll,
      sixes: parsed.sixes,
    };

    const choices = aeroplaneChoices(table, seat, roll);

    if (choices.length === 0) return null;

    const scored = choices.map((choice) => {
      // Opponent planes already sitting on the landing square: the move takes
      // them back to their hangar, which is the biggest swing after finishing.
      const victims = table.planes.reduce(
        (total, other, index) =>
          index === seat
            ? total
            : total + other.filter((progress) => progress === choice.land).length,
        0,
      );

      const before = planes[choice.plane - 1] ?? AEROPLANE_HANGAR;

      const score =
        (choice.home ? 1_000 : 0) +
        (victims > 0 && choice.land >= 0 ? 300 * victims : 0) +
        (choice.sentBack ? -400 : 0) +
        (choice.kind === "move" ? 100 : 0) +
        // Prefer the plane that is already closest to home.
        Math.max(0, choice.to) +
        (before === AEROPLANE_HANGAR ? -50 : 0);

      return { choice, score };
    });

    scored.sort((a, b) => b.score - a.score);

    const best = scored[0]?.choice;

    if (!best) return null;

    const actionType = best.kind === "launch" ? "launch_plane" : "move_plane";

    if (!legalActions.includes(actionType)) return null;

    return { actionType, data: { plane: best.plane } };
  },
};

/** Home square, exported for tests that describe a finished plane. */
export const AEROPLANE_HOME = AEROPLANE_CENTRE;
