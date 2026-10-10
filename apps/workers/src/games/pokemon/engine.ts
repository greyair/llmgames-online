import { isNumber } from "@llmgames/game-catalog";

import { Battle, Teams, toID, extractChannelMessages, type PRNGSeed } from "@pkmn/sim";
import { TeamGenerators } from "@pkmn/randoms";

Teams.setGeneratorFactory(TeamGenerators);

export const FORMAT = "gen1randombattle";

export type BattleSeat = "p1" | "p2";

interface MoveMatchupDetails {
  sameTypeBonus?: boolean;
  typeMatchup?: number;
  matchupTarget?: string;
}

interface MoveDamageDescription {
  damage?: string;
}

type SimPokemon = Battle["sides"][number]["pokemon"][number];

interface PokemonPrivateFields {
  slot?: number;
  stats?: SimPokemon["storedStats"];
  moves?: Array<{ name: string; pp: number; maxpp: number }>;
}

export function secureSeed(): PRNGSeed {
  const bytes = crypto.getRandomValues(new Uint8Array(32));

  return `sodium,${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function createBattle(): Battle {
  const battle = new Battle({ formatid: toID(FORMAT), seed: secureSeed() });

  for (const id of ["p1", "p2"] as const) {
    battle.setPlayer(id, {
      name: id,
      team: Teams.generate(FORMAT, { seed: secureSeed() }),
    });
  }

  return battle;
}

export function decision(battle: Battle, id: BattleSeat) {
  const side = battle.getSide(id);
  const request = side.activeRequest;

  if (battle.ended || !request || request.wait || side.isChoiceDone()) return null;
  const active = "active" in request ? request.active[0] : undefined;

  return {
    forceSwitch: "forceSwitch" in request && Boolean(request.forceSwitch?.[0]),
    moves:
      active?.moves.map((move, i) => {
        const special = move.id === "recharge" || move.id === "fight";
        const data = battle.dex.moves.get(move.id);
        const user = side.active[0];
        const target = side.foe.active[0];

        // Type-chart guidance only, never a damage forecast or a hidden-state query.
        const standardDamage =
          data.category !== "Status" &&
          !data.damage &&
          !data.damageCallback &&
          !data.ohko &&
          data.id !== "struggle";

        const targetTypes = target?.getTypes();

        const typeMatchup =
          standardDamage && targetTypes
            ? battle.dex.getImmunity(data.type, targetTypes)
              ? 2 ** battle.dex.getEffectiveness(data.type, targetTypes)
              : 0
            : undefined;

        const moveIdentity = {
          slot: i + 1,
          name: move.move,
          id: move.id,
          disabled: Boolean(move.disabled),
        };

        if (special)
          return {
            ...moveIdentity,
            description:
              move.id === "recharge"
                ? "Submit this slot to spend the turn recharging; switching is unavailable."
                : "Submit this slot to attempt to act while asleep, frozen or partially trapped; the engine resolves the result. You may switch if listed.",
          };
        const matchup: MoveMatchupDetails = {};

        if (standardDamage) matchup.sameTypeBonus = Boolean(user?.hasType(data.type));

        if (typeMatchup !== undefined) {
          matchup.typeMatchup = typeMatchup;
          matchup.matchupTarget = target?.name;
        }

        const damage: MoveDamageDescription = {};

        if (data.id === "superfang") damage.damage = "Half the target’s current HP";
        else if (data.damage === "level") damage.damage = "Equal to the user’s level";
        else if (isNumber(data.damage)) damage.damage = `${data.damage} HP`;

        return {
          ...moveIdentity,
          pp: move.pp,
          maxpp: move.maxpp,
          type: data.type,
          category: data.category,
          priority: data.priority,
          ...matchup,
          power: data.basePower,
          ...damage,
          accuracy: data.accuracy,
          description: data.shortDesc,
          fullDescription: data.desc,
        };
      }) ?? [],
    switches: active?.trapped
      ? []
      : side.pokemon.flatMap((pokemon, i) =>
          !pokemon.fainted && !pokemon.isActive ? [{ slot: i + 1, name: pokemon.name }] : [],
        ),
  };
}

export function battleView(battle: Battle, viewer: BattleSeat | null, reveal = false) {
  const channel = reveal ? -1 : viewer === "p1" ? 1 : viewer === "p2" ? 2 : 0;

  const logs = extractChannelMessages(battle.log.join("\n"), [channel])[channel];

  const visibleLog = logs.filter(
    (line) => !/^\|(t:|player|seed|teamsize|gametype|gen|tier|rule)\|/.test(line),
  );

  const revealed = new Set(
    logs.flatMap((line) => {
      const parts = line.split("|");

      return ["switch", "drag", "replace"].includes(parts[1] ?? "") ? [parts[2]] : [];
    }),
  );

  return {
    format: FORMAT,
    yourSeat: viewer,
    battleTurn: battle.turn,
    sides: battle.sides.map((side) => ({
      seat: side.id,
      pokemon: side.pokemon.map((pokemon, i) => {
        const own = reveal || viewer === side.id;
        const seen = revealed.has(`${side.id}a: ${pokemon.name}`);

        if (!own && !seen) return { hidden: true as const };

        const privateFields: PokemonPrivateFields = {};

        if (own) privateFields.slot = i + 1;

        const publicFields = {
          ...privateFields,
          name: pokemon.name,
          species: pokemon.species.name,
          sprite: pokemon.baseSpecies.id,
          level: pokemon.level,
          active: pokemon.isActive,
          fainted: pokemon.fainted,
          condition: own ? pokemon.getHealth().secret : pokemon.getHealth().shared,
          revealedMoves: [
            ...new Set(
              logs.flatMap((line) => {
                const parts = line.split("|");

                return parts[1] === "move" && parts[2] === `${side.id}a: ${pokemon.name}`
                  ? [parts[3]!]
                  : [];
              }),
            ),
          ],
          types: pokemon.getTypes(),
          boosts: pokemon.isActive ? pokemon.boosts : undefined,
          // Only publicly observable flags. Never serialize volatile objects,
          // hidden durations, damage counters, source references or Substitute HP.
          effects: pokemon.isActive
            ? [
                "substitute",
                "confusion",
                "reflect",
                "lightscreen",
                "leechseed",
                "focusenergy",
                "mist",
                "bide",
                "rage",
                "disable",
              ].filter((effect) => Boolean(pokemon.volatiles[effect]))
            : [],
        };

        const projected: typeof publicFields & PokemonPrivateFields = publicFields;

        if (own) {
          projected.stats = pokemon.storedStats;
          projected.moves = pokemon.moveSlots.map((move) => ({
            name: move.move,
            pp: move.pp,
            maxpp: move.maxpp,
          }));
        }

        return projected;
      }),
    })),
    decision: viewer ? decision(battle, viewer) : null,
    battleLogOffset: Math.max(0, visibleLog.length - 60),
    battleLog: visibleLog.slice(-60),
  };
}
