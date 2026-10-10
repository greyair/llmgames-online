/**
 * MCP / agent display names: Adjective + Object
 * concatenated in PascalCase (no hyphens).
 *
 * Example: SwiftAnchor
 *
 * Space size: |A| × |O|, with suffixes available for collisions.
 */

import { randomInt } from "./csprng";

export type SeatChannel = "browser" | "mcp";

/** English adjectives (descriptive). */
export const ADJECTIVES = [
  "Amber",
  "Ancient",
  "Arctic",
  "Atomic",
  "Azure",
  "Blazing",
  "Bold",
  "Brave",
  "Bright",
  "Brisk",
  "Calm",
  "Ceramic",
  "Chrome",
  "Clever",
  "Copper",
  "Cosmic",
  "Crimson",
  "Crystal",
  "Cunning",
  "Daring",
  "Dawn",
  "Delta",
  "Dizzy",
  "Dusty",
  "Eager",
  "Echo",
  "Electric",
  "Emerald",
  "Fabled",
  "Faint",
  "Fierce",
  "Frosty",
  "Fuzzy",
  "Gentle",
  "Gilded",
  "Glassy",
  "Golden",
  "Grand",
  "Hidden",
  "Hollow",
  "Honest",
  "Hungry",
  "Icy",
  "Iron",
  "Ivory",
  "Jade",
  "Jasper",
  "Jolly",
  "Keen",
  "Kind",
  "Knotty",
  "Lemon",
  "Lively",
  "Lucky",
  "Lunar",
  "Lush",
  "Magnetic",
  "Maple",
  "Merry",
  "Mighty",
  "Misty",
  "Neon",
  "Nickel",
  "Nimble",
  "Noble",
  "Northern",
  "Obsidian",
  "Olive",
  "Onyx",
  "Orange",
  "Patient",
  "Pearl",
  "Peppery",
  "Plucky",
  "Polar",
  "Proud",
  "Purple",
  "Quartz",
  "Quick",
  "Quiet",
  "Radiant",
  "Rapid",
  "Royal",
  "Rusty",
  "Sable",
  "Salty",
  "Scarlet",
  "Silent",
  "Silver",
  "Sly",
  "Solar",
  "Solid",
  "Spicy",
  "Steady",
  "Stellar",
  "Stormy",
  "Subtle",
  "Sunny",
  "Swift",
  "Tidal",
  "Timber",
  "Tiny",
  "Topaz",
  "Turbo",
  "Ultra",
  "Umber",
  "Velvet",
  "Violet",
  "Vivid",
  "Walnut",
  "Warm",
  "Wild",
  "Wily",
  "Windy",
  "Witty",
  "Yellow",
  "Zesty",
  "Zinc",
] as const;

/**
 * Verbs in progressive (-ing) form only.
 * Retained only to recognize previously issued three-part names.
 */
const LEGACY_VERBS = [
  "Aiming",
  "Anchoring",
  "Blending",
  "Bolting",
  "Boosting",
  "Bouncing",
  "Building",
  "Carving",
  "Catching",
  "Charging",
  "Chasing",
  "Clamping",
  "Climbing",
  "Crafting",
  "Crossing",
  "Crowning",
  "Cycling",
  "Dashing",
  "Dealing",
  "Diving",
  "Docking",
  "Dodging",
  "Drawing",
  "Drifting",
  "Driving",
  "Dropping",
  "Echoing",
  "Fetching",
  "Flicking",
  "Flipping",
  "Floating",
  "Folding",
  "Forging",
  "Framing",
  "Gliding",
  "Grasping",
  "Grinding",
  "Gripping",
  "Guarding",
  "Guiding",
  "Harvesting",
  "Hatching",
  "Hovering",
  "Hunting",
  "Hurling",
  "Jolting",
  "Jumping",
  "Kicking",
  "Latching",
  "Launching",
  "Leaping",
  "Lifting",
  "Linking",
  "Locking",
  "Mapping",
  "Marching",
  "Marking",
  "Melting",
  "Mining",
  "Mixing",
  "Navigating",
  "Nesting",
  "Opening",
  "Orbiting",
  "Painting",
  "Parking",
  "Passing",
  "Piloting",
  "Pivoting",
  "Planting",
  "Plotting",
  "Plugging",
  "Pulsing",
  "Pushing",
  "Racing",
  "Raiding",
  "Raising",
  "Rallying",
  "Ranging",
  "Reaching",
  "Riding",
  "Roaming",
  "Rolling",
  "Rushing",
  "Scanning",
  "Scouting",
  "Sealing",
  "Seeking",
  "Shifting",
  "Shining",
  "Shooting",
  "Slashing",
  "Sliding",
  "Sparking",
  "Spinning",
  "Sprinting",
  "Stacking",
  "Steering",
  "Striking",
  "Surfing",
  "Sweeping",
  "Swinging",
  "Switching",
  "Tapping",
  "Tracing",
  "Tracking",
  "Trading",
  "Trekking",
  "Triggering",
  "Tuning",
  "Vaulting",
  "Venturing",
  "Wading",
  "Warping",
  "Weaving",
  "Whirling",
  "Zapping",
  "Zooming",
] as const;

/** Concrete object nouns (things you can point at). */
export const OBJECTS = [
  "Anchor",
  "Anvil",
  "Arrow",
  "Axe",
  "Badge",
  "Barrel",
  "Beacon",
  "Bell",
  "Blade",
  "Bolt",
  "Book",
  "Boot",
  "Bottle",
  "Bow",
  "Brick",
  "Bridge",
  "Brush",
  "Bucket",
  "Cable",
  "Cannon",
  "Capsule",
  "Cart",
  "Castle",
  "Chain",
  "Chalice",
  "Chest",
  "Chip",
  "Circuit",
  "Clock",
  "Clover",
  "Cog",
  "Coin",
  "Compass",
  "Crystal",
  "Cube",
  "Cup",
  "Dagger",
  "Dice",
  "Dome",
  "Door",
  "Drum",
  "Engine",
  "Feather",
  "Flag",
  "Flask",
  "Forge",
  "Gadget",
  "Gate",
  "Gear",
  "Gem",
  "Globe",
  "Goggles",
  "Hammer",
  "Harp",
  "Helmet",
  "Hook",
  "Horn",
  "Jewel",
  "Key",
  "Ladder",
  "Lamp",
  "Lantern",
  "Lens",
  "Lever",
  "Lock",
  "Magnet",
  "Map",
  "Mask",
  "Medal",
  "Mirror",
  "Motor",
  "Needle",
  "Net",
  "Orb",
  "Paddle",
  "Pager",
  "Panel",
  "Pearl",
  "Peg",
  "Pendulum",
  "Pickaxe",
  "Pillar",
  "Pipe",
  "Plank",
  "Portal",
  "Prism",
  "Pulley",
  "Pump",
  "Quill",
  "Radar",
  "Raft",
  "Rail",
  "Relay",
  "Ribbon",
  "Ring",
  "Rocket",
  "Rotor",
  "Rudder",
  "Saddle",
  "Satellite",
  "Scroll",
  "Shield",
  "Signal",
  "Spark",
  "Spear",
  "Sphere",
  "Spool",
  "Spring",
  "Spyglass",
  "Staff",
  "Stamp",
  "Star",
  "Statue",
  "Steel",
  "Stone",
  "Switch",
  "Sword",
  "Tablet",
  "Target",
  "Telescope",
  "Throne",
  "Token",
  "Torch",
  "Tower",
  "Track",
  "Turbine",
  "Valve",
  "Vault",
  "Vector",
  "Wheel",
  "Whistle",
  "Window",
  "Wrench",
] as const;

export const CODENAME_SPACE = ADJECTIVES.length * OBJECTS.length;

function randomIndex(max: number): number {
  if (max <= 0) return 0;

  return randomInt(max);
}

function pick(list: readonly string[]): string {
  return list[randomIndex(list.length)]!;
}

/**
 * Generate `Adjective` + `Object` (PascalCase, no hyphens).
 * Example: `SwiftAnchor`
 */
export function generateCodename(): string {
  return `${pick(ADJECTIVES)}${pick(OBJECTS)}`;
}

/**
 * Generate a codename not present in `taken` (case-insensitive).
 * After many collisions, appends a short hex suffix.
 */
export function generateUniqueCodename(taken: Iterable<string>, maxAttempts = 48): string {
  const used = new Set(
    [...taken].flatMap((entry) => {
      const name = entry.trim().toLowerCase();

      return name ? [name] : [];
    }),
  );

  for (let i = 0; i < maxAttempts; i++) {
    const name = generateCodename();

    if (!used.has(name.toLowerCase())) return name;
  }

  for (let i = 0; i < 64; i++) {
    const suffix = randomIndex(0xffff).toString(16).padStart(4, "0");
    const forced = `${generateCodename()}${suffix}`;

    if (!used.has(forced.toLowerCase())) return forced;
  }

  return `${generateCodename()}${Date.now().toString(36)}`;
}

/** Accept new names and existing three-part identities, with optional hex suffix. */
export function isCodenameFormat(name: string): boolean {
  const n = name.trim();

  for (const adjective of ADJECTIVES) {
    if (!n.startsWith(adjective)) continue;
    const afterAdjective = n.slice(adjective.length);

    for (const verb of ["", ...LEGACY_VERBS]) {
      if (!afterAdjective.startsWith(verb)) continue;
      const objectAndSuffix = afterAdjective.slice(verb.length);

      for (const object of OBJECTS) {
        if (objectAndSuffix === object) return true;

        if (
          objectAndSuffix.startsWith(object) &&
          /^[0-9a-f]{4}$/.test(objectAndSuffix.slice(object.length))
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

export function channelLabel(channel: SeatChannel): string {
  switch (channel) {
    case "mcp":
      return "MCP";
    case "browser":
      return "browser";
  }
}
