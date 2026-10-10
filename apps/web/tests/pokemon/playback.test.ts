import { describe, it, expect } from "vitest";
import { applyCue, parseCues, moveVisual, type Side } from "../../src/features/pokemon/playback";
import moves from "../../src/features/pokemon/gen1-moves.json";

describe("Pokémon presentation protocol", () => {
  it("covers every Gen 1 move and assigns distinct elemental effects", () => {
    expect(Object.keys(moves)).toHaveLength(165);

    for (const move of Object.values(moves)) expect(moveVisual(move.name).family).toBeTruthy();
    expect(moveVisual("Thunderbolt").family).toBe("electric");
    expect(moveVisual("Fire Blast").family).toBe("fire");
    expect(moveVisual("Ice Beam").family).toBe("beam");
    expect(moveVisual("Surf").family).toBe("surf");
    expect(moveVisual("Slash").family).toBe("slash");
    expect(moveVisual("Psychic").family).toBe("psychic");
    expect(moveVisual("Earthquake").family).toBe("earth");
  });
  it("uses the published preparation phase without firing a charging attack early", () => {
    const cues = parseCues(
      [
        "|move|p1a: Charizard|Solar Beam|p2a: Blastoise|[still]",
        "|-prepare|p1a: Charizard|Solar Beam",
      ],
      0,
    );

    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({
      moveId: "solarbeam",
      animationPhase: "prepare",
      actor: "p1",
      target: "p1",
    });
  });
  it("keeps attack, damage, faint and switch order with stable absolute IDs", () => {
    const lines = [
      "|move|p1a: Zapdos|Thunderbolt|p2a: Blastoise",
      "|-damage|p2a: Blastoise|0 fnt",
      "|faint|p2a: Blastoise",
      "|switch|p2a: Snorlax|Snorlax, L100|100/100",
    ];

    const cues = parseCues(lines, 100);
    expect(cues.map((c) => c.kind)).toEqual(["move", "hit", "faint", "exit", "enter"]);
    expect(cues.map((c) => c.id)).toEqual([200, 202, 204, 206, 207]);
    expect(cues[0]).toMatchObject({
      actor: "p1",
      target: "p2",
      family: "electric",
    });
    expect(parseCues(lines.slice(2), 102)).toEqual(cues.slice(2));
  });
  it("does not animate requests or sealed choices and does not show impacts on misses", () => {
    expect(parseCues(['|request|{"active":[]}', "|choice|move 1", "|turn|3"], 0)).toEqual([]);

    const [miss] = parseCues(
      ["|move|p2a: Tauros|Hyper Beam|p1a: Mew", "|-miss|p2a: Tauros|p1a: Mew"],
      0,
    );

    expect(miss).toMatchObject({ missed: true });
  });
  it("uses only server-reported HP and does not reveal an incoming Pokémon until switch-in", () => {
    const before: Side[] = [
      {
        seat: "p2",
        pokemon: [{ name: "Blastoise", active: true, condition: "100/100" }, { hidden: true }],
      },
    ];

    const after: Side[] = [
      {
        seat: "p2",
        pokemon: [
          {
            name: "Snorlax",
            active: true,
            condition: "75/100",
            sprite: "snorlax",
          },
          { name: "Blastoise", active: false, condition: "50/100" },
        ],
      },
    ];

    const cues = parseCues(
      ["|switch|p2a: Snorlax|Snorlax, L100|100/100", "|-damage|p2a: Snorlax|75/100"],
      0,
    );

    expect(applyCue(before, cues[0]!, after)).toEqual(before);
    const entered = applyCue(before, cues[1]!, after);
    expect(entered[0]!.pokemon.find((p) => p.active)).toMatchObject({
      name: "Snorlax",
      condition: "100/100",
    });
    expect(applyCue(entered, cues[2]!, after)[0]!.pokemon.find((p) => p.active)?.condition).toBe(
      "75/100",
    );
  });
});
