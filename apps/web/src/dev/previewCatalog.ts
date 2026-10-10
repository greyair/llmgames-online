import { knownValue } from "@/domain/view-contracts";

export const previewScreens = [
  { id: "library", name: "Game library" },
  { id: "history", name: "History" },
  { id: "spectator", name: "Spectator mode" },
  { id: "profile", name: "Profile" },
  { id: "connect-ai", name: "Connect AI" },
  { id: "setup", name: "Room setup" },
  { id: "connect4", name: "Connect 4" },
  { id: "checkers", name: "Checkers" },
  { id: "reversi", name: "Reversi" },
  { id: "codenames", name: "Codenames" },
  { id: "poker", name: "Poker" },
  { id: "battleship", name: "Battleship" },
  { id: "placement", name: "Fleet placement" },
  { id: "pokemon", name: "Pokémon" },
  { id: "contexto", name: "Contexto" },
] as const;

const sharedStates = [
  "playing",
  "agents",
  "signed-out",
  "auth-loading",
  "auth-error",
  "auth-code",
  "auth-onboarding",
  "waiting",
  "urgent",
  "spectator",
  "spectator-ended",
  "lobby-spectator",
  "win",
  "loss",
  "draw",
  "room-setup",
  "lobby-host",
  "lobby-player",
  "lobby-waiting",
  "lobby-jev",
  "host-spectating",
  "leave-confirmation",
  "action-error",
];

const gameStates = {
  connect4: ["opening", "full-column"],
  reversi: ["opening", "forced-pass", "endgame"],
  codenames: [
    "clue",
    "blue-clue",
    "blue-guess",
    "spymaster-waiting",
    "clue-zero",
    "clue-unlimited",
    "guess-used",
    "assassin",
    "full-teams",
    "lobby-unassigned",
  ],
  poker: [
    "preflop",
    "turn",
    "river",
    "check-bet",
    "all-in",
    "folded",
    "heads-up",
    "showdown",
    "split-pot",
  ],
  battleship: ["placement-empty", "placement-ready", "no-energy", "all-weapons", "sunk-ship"],
  placement: ["placement-ready"],
  pokemon: [
    "move-effects",
    "forced-switch",
    "choice-locked",
    "low-hp",
    "status-effects",
    "disabled-moves",
    "last-pokemon",
  ],
  contexto: ["aliased-guess", "not-in-pool", "near-limit", "replay", "replay-ended"],
} satisfies Record<string, string[]>;

export function previewStates(screen: string) {
  if (screen === "history") return ["featured"];

  if (screen === "spectator")
    return [
      "directory",
      "loading",
      "watching",
      "creating",
      "finished",
      "empty",
      ...[
        "contexto",
        "connect4",
        "checkers",
        "reversi",
        "codenames",
        "poker",
        "battleship",
        "pokemon",
      ].map((game) => `watch-${game}`),
      "watch-poker-heads-up",
      "watch-poker-showdown",
    ];

  if (screen === "profile") return ["jev-disconnected", "jev-connected"];

  if (screen === "connect-ai") return ["playing"];

  if (screen === "library")
    return ["playing", "signed-out", "auth-loading", "auth-error", "auth-code", "auth-onboarding"];

  if (screen === "setup")
    return [
      "playing",
      "signed-out",
      "auth-loading",
      "auth-error",
      "auth-code",
      "auth-onboarding",
      "lobby-spectator",
      "lobby-host",
      "lobby-player",
      "lobby-waiting",
      "lobby-jev",
      "jev-trial-used",
      "host-spectating",
      "action-error",
    ];

  return [...sharedStates, ...(knownValue(gameStates, screen) ?? [])];
}

export function previewStateLabel(state: string) {
  return (
    knownValue(
      {
        featured: "Featured games",
        directory: "All games",
        watching: "Watching a game",
        creating: "Game being created",
        finished: "Recently finished game",
        empty: "No games",
        "signed-out": "Signed out · sign in required",
        "auth-loading": "Sign-in loading",
        "auth-error": "Sign-in error",
        "auth-code": "Email code",
        "auth-onboarding": "Choose username",
        "spectator-ended": "Spectator · completed match",
        "lobby-spectator": "Lobby · watching as spectator",
        playing: "Playing",
        waiting: "Opponent’s turn",
        urgent: "Timer running low",
        spectator: "Spectator",
        clue: "Red spymaster / clue input",
        "blue-clue": "Blue spymaster / clue input",
        "move-effects": "Move effects",
        "room-setup": "Create / join room",
        "lobby-host": "Lobby · ready to start",
        "lobby-player": "Lobby · waiting for host",
        "lobby-waiting": "Lobby · missing players",
        "lobby-jev": "Lobby · Try Jev",
        "jev-trial-used": "Lobby · Jev trial used",
        "jev-disconnected": "TypeSafe disconnected",
        "jev-connected": "TypeSafe connected",
        "host-spectating": "Lobby · spectator host",
        win: "You win",
        loss: "You lose",
        draw: "Draw",
        "leave-confirmation": "Leave confirmation",
        "action-error": "Action error",
        "clue-zero": "Zero clue",
        "clue-unlimited": "Unlimited clue",
      },
      state,
    ) ??
    state
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}

/** Keep the directory and in-game selector organized in the same order. */
export function previewStateGroups(screen: string) {
  if (screen === "spectator") return [{ label: "Spectator mode", states: previewStates(screen) }];

  const groups: Array<{ label: string; states: string[] }> = [
    { label: "Gameplay", states: [] },
    { label: "Results", states: [] },
    { label: "Room and lobby", states: [] },
    { label: "Spectator views", states: [] },
    { label: "Sign-in states", states: [] },
    { label: "Errors and dialogs", states: [] },
  ];

  const results = new Set(["win", "loss", "draw", "showdown", "split-pot", "assassin"]);

  for (const state of previewStates(screen)) {
    const group =
      state === "signed-out" || state.startsWith("auth-")
        ? 4
        : state === "action-error" || state === "leave-confirmation"
          ? 5
          : state.startsWith("spectator")
            ? 3
            : state.startsWith("lobby-") || ["room-setup", "host-spectating"].includes(state)
              ? 2
              : results.has(state)
                ? 1
                : 0;

    groups[group]!.states.push(state);
  }

  if (screen === "library" || screen === "setup") groups[0]!.label = "Overview";

  return groups.filter((group) => group.states.length > 0);
}
