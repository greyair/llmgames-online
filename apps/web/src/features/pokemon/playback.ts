import { knownValue } from "@/domain/view-contracts";
import moves from "./gen1-moves.json";

export type Monster = {
  hidden?: boolean;
  slot?: number;
  name?: string;
  species?: string;
  sprite?: string;
  level?: number;
  active?: boolean;
  fainted?: boolean;
  condition?: string;
  types?: string[];
  moves?: { name: string; pp: number; maxpp: number }[];
  revealedMoves?: string[];
  effects?: string[];
  stats?: Partial<Record<"atk" | "def" | "spa" | "spd" | "spe", number>>;
  boosts?: Partial<Record<"atk" | "def" | "spa" | "spd" | "spe" | "accuracy" | "evasion", number>>;
};

export type Side = { seat: string; pokemon: Monster[] };

export type Seat = "p1" | "p2";

export type Cue = {
  id: number;
  kind: "move" | "hit" | "heal" | "status" | "faint" | "exit" | "enter" | "message";
  actor: Seat;
  target: Seat;
  label: string;
  name?: string;
  moveId?: string;
  animationPhase?: "prepare";
  condition?: string;
  type?: string;
  family?: string;
  missed?: boolean;
  duration: number;
};

const id = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

const seat = (ident = ""): Seat | null =>
  ident.startsWith("p1") ? "p1" : ident.startsWith("p2") ? "p2" : null;

const name = (ident = "") => ident.replace(/^p[12][a-z]?: /, "");

export function moveVisual(move: string) {
  const key = id(move);

  const data = Object.prototype.hasOwnProperty.call(moves, key)
    ? knownValue(moves, key)
    : undefined;

  let family = data?.status
    ? "status"
    : ((
        {
          Fire: "fire",
          Water: "water",
          Ice: "ice",
          Electric: "electric",
          Grass: "leaf",
          Psychic: "psychic",
          Ghost: "ghost",
          Poison: "poison",
          Ground: "earth",
          Rock: "rock",
          Flying: "wind",
          Dragon: "beam",
          Bug: "leaf",
        } satisfies Record<string, string>
      )[data?.type ?? ""] ?? "strike");

  if (["hyperbeam", "solarbeam", "psybeam", "aurorabeam", "icebeam", "bubblebeam"].includes(key))
    family = "beam";

  if (["hydropump", "watergun"].includes(key)) family = "water";

  if (key === "surf") family = "surf";

  if (["slash", "scratch", "furyswipes", "cut"].includes(key)) family = "slash";

  if (
    ["recover", "rest", "softboiled", "absorb", "megadrain", "leechseed"].includes(key) &&
    data?.status
  )
    family = "heal";

  return { family, type: data?.type ?? "Normal", self: data?.self ?? false };
}

/** Parse resolved Showdown protocol only; requests and sealed choices never enter this queue. */
export function parseCues(lines: string[], offset: number): Cue[] {
  return lines.flatMap((line, i): Cue[] => {
    const p = line.split("|");
    const actor = seat(p[2]);

    if (!actor) return [];

    const base = {
      id: (offset + i) * 2,
      actor,
      target: actor,
      name: name(p[2]),
    };

    if (p[1] === "-prepare") {
      const visual = moveVisual(p[3] ?? "");

      return [
        {
          ...base,
          ...visual,
          kind: "move",
          moveId: id(p[3] ?? ""),
          animationPhase: "prepare",
          target: actor,
          label: `${name(p[2])} is preparing ${p[3]}`,
          duration: 660,
        },
      ];
    }

    if (p[1] === "move") {
      if (p.includes("[still]")) return [];
      const visual = moveVisual(p[3] ?? "");
      const remaining = lines.slice(i + 1);
      const nextMove = remaining.findIndex((line) => line.startsWith("|move|"));
      const following = nextMove < 0 ? remaining : remaining.slice(0, nextMove);
      const missed = following.some((l) => /^\|-(miss|fail|immune)\|/.test(l));

      return [
        {
          ...base,
          kind: "move",
          moveId: id(p[3] ?? ""),
          target: seat(p[4]) ?? (visual.self ? actor : actor === "p1" ? "p2" : "p1"),
          label: `${name(p[2])} used ${p[3]}`,
          ...visual,
          missed,
          duration: 660,
        },
      ];
    }

    if (["switch", "drag", "replace"].includes(p[1] ?? ""))
      return [
        { ...base, kind: "exit", label: "", duration: 160 },
        {
          ...base,
          id: base.id + 1,
          kind: "enter",
          label: `Go, ${name(p[2])}!`,
          condition: p[4],
          duration: 300,
        },
      ];

    if (p[1] === "-damage")
      return [{ ...base, kind: "hit", label: "", condition: p[3], duration: 400 }];

    if (p[1] === "-heal")
      return [
        {
          ...base,
          kind: "heal",
          label: `${name(p[2])} recovered HP`,
          condition: p[3],
          duration: 330,
        },
      ];

    if (p[1] === "faint")
      return [
        {
          ...base,
          kind: "faint",
          label: `${name(p[2])} fainted`,
          condition: "0 fnt",
          duration: 350,
        },
      ];

    if (p[1] === "-status")
      return [
        {
          ...base,
          kind: "status",
          label: `${name(p[2])}: ${p[3]}`,
          condition: p[3],
          duration: 280,
        },
      ];

    if (p[1] === "-curestatus")
      return [
        {
          ...base,
          kind: "status",
          label: `${name(p[2])} recovered`,
          condition: "",
          duration: 250,
        },
      ];

    if (p[1] === "-boost" || p[1] === "-unboost") {
      const stat =
        (
          {
            atk: "Attack",
            def: "Defense",
            spa: "Special",
            spd: "Special",
            spe: "Speed",
            accuracy: "Accuracy",
            evasion: "Evasion",
          } satisfies Record<string, string>
        )[p[3] ?? ""] ?? p[3];

      return [
        {
          ...base,
          kind: "message",
          label: `${stat} ${p[1] === "-boost" ? "+" : "−"}${p[4]} stages`,
          duration: 650,
        },
      ];
    }

    const messages = {
      "-miss": "Missed!",
      "-immune": "No effect",
      "-fail": "But it failed",
      "-crit": "Critical hit!",
      "-supereffective": "Super effective!",
      "-resisted": "Not very effective",
    } satisfies Record<string, string>;

    if (knownValue(messages, p[1] ?? ""))
      return [{ ...base, kind: "message", label: knownValue(messages, p[1]!)!, duration: 180 }];

    return [];
  });
}

/** Apply only reported presentation values, never calculate damage or game rules. */
export function applyCue(sides: Side[], cue: Cue, finalSides: Side[]): Side[] {
  if (!["enter", "hit", "heal", "status", "faint"].includes(cue.kind)) return sides;

  return sides.map((side) => {
    if (side.seat !== cue.actor) return side;
    let pokemon = side.pokemon.map((p) => ({ ...p }));

    if (cue.kind === "enter") {
      const incoming = finalSides
        .find((s) => s.seat === cue.actor)
        ?.pokemon.find((p) => p.name === cue.name);

      if (!incoming) return side;
      let index = pokemon.findIndex((p) => p.name === cue.name);

      if (index < 0) index = pokemon.findIndex((p) => p.hidden);

      if (index < 0) return side;
      pokemon = pokemon.map((p) => ({ ...p, active: false }));
      pokemon[index] = {
        ...incoming,
        active: true,
        fainted: false,
        condition: cue.condition,
      };
    } else {
      pokemon = pokemon.map((p) => {
        if (p.name !== cue.name) return p;

        const condition =
          cue.kind === "status"
            ? `${p.condition?.split(" ")[0] ?? "100/100"}${cue.condition ? " " + cue.condition : ""}`
            : cue.condition;

        const next = { ...p, condition };

        if (cue.kind === "faint") next.fainted = true;

        return next;
      });
    }

    return { ...side, pokemon };
  });
}
