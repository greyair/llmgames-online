export const statLabel = (stat: string) =>
  ({
    atk: "Attack",
    def: "Defense",
    spa: "Special",
    spd: "Special",
    spc: "Special",
    spe: "Speed",
    accuracy: "Accuracy",
    evasion: "Evasion",
  })[stat] ?? stat;

export const statusLabel = (status: string) =>
  ({
    par: "Paralyzed",
    brn: "Burned",
    psn: "Poisoned",
    tox: "Badly poisoned",
    slp: "Asleep",
    frz: "Frozen",
    fnt: "Fainted",
  })[status] ?? status;

export const effectLabel = (effect: string) =>
  ({
    substitute: "Substitute",
    confusion: "Confused",
    reflect: "Reflect",
    lightscreen: "Light Screen",
    leechseed: "Leech Seed",
    focusenergy: "Focus Energy",
    mist: "Mist",
    bide: "Bide",
    rage: "Rage",
    disable: "Disable",
  })[
    effect
      .replace(/^move: /, "")
      .toLowerCase()
      .replaceAll(" ", "")
  ] ?? effect.replace(/^move: /, "");

export const effectDescription = {
  substitute: "A substitute is taking hits for this Pokémon.",
  confusion: "May hurt itself instead of using its move.",
  reflect: "Raises Defense against physical attacks.",
  lightscreen: "Raises Special when taking special attacks.",
  leechseed: "Loses HP at the end of the turn to the opposing Pokémon.",
  focusenergy: "Gen 1 quirk: lowers critical-hit chance instead of raising it.",
  mist: "Protects against stat drops from status moves.",
  bide: "Storing damage to return to the opponent.",
  rage: "Attack can rise when this Pokémon takes a hit.",
  disable: "One move is temporarily unavailable.",
} satisfies Record<string, string>;
