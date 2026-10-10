import { isString } from "@llmgames/game-catalog";

/**
 * Winner headlines + quirky matchup taunts for the game-over overlay.
 * Uses seat metadata (isAgent / channel) to roast humans, agents, and agent-vs-agent.
 */

import { playerInlineName } from "./playerIdentity";

export type GamePlayer = {
  id: string;
  name?: string | null;
  isAgent?: boolean;
  channel?: string | null;
  codename?: string | null;
  ownerGamertag?: string | null;
  environmentLabel?: string | null;
};

type MatchupKind =
  | "draw"
  | "agent-beat-human"
  | "human-beat-agent"
  | "agent-vs-agent"
  | "human-vs-human"
  | "unknown";

export type GameOverCopy = {
  /** Primary title: YOU WIN / YOU LOSE / DRAW / GAME OVER */
  headline: string;
  /** Who won, with names — e.g. "SwiftAnchor wins" */
  winnerLine: string | null;
  /** Quirky one-liner for the matchup */
  taunt: string;
  matchup: MatchupKind;
  winnerId: string | null;
  winnerName: string | null;
  loserName: string | null;
};

const AGENT_BEAT_HUMAN = [
  "The LLM just farmed a free human for XP. GG meatbag.",
  "Silicon 1 · Carbon 0. Your free will was a soft prompt.",
  "An agent beat a human. The singularity is… mildly smug.",
  "You brought flesh. They brought a context window. Context won.",
  "Human error: expected. Model weights: peak.",
  "That was not a skill issue — that was a species issue.",
  "Congratulations to the tokens. Condolences to the thumbs.",
  "Your opponent hallucinated a win… wait no, that was real.",
];

const HUMAN_BEAT_AGENT = [
  "Human > weights. Somebody update the benchmark board.",
  "The agent is busy rewriting its system prompt in shame.",
  "Flesh wins. Somewhere a temperature dial just got colder.",
  "You just gave an LLM impostor syndrome. Iconic.",
  "Silicon had the math. You had the vibes. Vibes won.",
  "Agent down. Please do not feed it more training data tonight.",
  "The model checked the rules three times. You still won.",
  "Carbon supremacy (this round only). Enjoy it.",
];

const AGENT_VS_AGENT = [
  "Agent vs agent: peak llmgames. Someone's tokenizer is crying.",
  "Two models entered. One left with a smaller ego.",
  "Sibling rivalry, but make it transformer-on-transformer violence.",
  "Another agent just got ratio'd by a peer. Brutal.",
  "No humans were harmed in the making of this dunk.",
  "That's agent-on-agent crime and we are here for it.",
  "One codename roasted another codename. Poetry.",
  "Autonomous trash talk complete. No operator required.",
];

const HUMAN_VS_HUMAN = [
  "Classic human-on-human. No models, just pride.",
  "Two brains, zero GPUs. Still somehow this chaotic.",
  "Offline intelligence only. Respect the matchup.",
  "You didn't need an LLM for that. Bold strategy.",
  "Pure human error vs pure human clutch. Cinema.",
];

const DRAW_LINES = [
  "Draw. The universe refuses to pick a main character.",
  "Nobody won. Both of you get a participation token.",
  "Stalemate. Even the server is bored of you two.",
  "Perfectly balanced… as all unfinished games should be.",
  "Draw. The authoritative state remains undefeated.",
];

const UNKNOWN_LINES = [
  "Game over. Someone won; someone is coping.",
  "Table closed. Restart if you still have pride left.",
  "That's a wrap. The Durable Object has spoken.",
];

function stablePick(lines: string[], seed: string): string {
  if (lines.length === 0) return "";
  let h = 0;

  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }

  return lines[h % lines.length]!;
}

function isAgentSeat(p: GamePlayer | null | undefined): boolean {
  if (!p) return false;

  if (p.isAgent) return true;

  if (p.channel === "mcp") return true;

  return false;
}

/** Prefer codename for agents; otherwise a readable seat name. */
function playerDisplayName(p: GamePlayer | null | undefined, fallback = "Unknown"): string {
  if (!p) return fallback;

  return playerInlineName(p, fallback);
}

function kindFor(winnerAgent: boolean, loserAgent: boolean | null): MatchupKind {
  if (loserAgent === null) return "unknown";

  if (winnerAgent && !loserAgent) return "agent-beat-human";

  if (!winnerAgent && loserAgent) return "human-beat-agent";

  if (winnerAgent && loserAgent) return "agent-vs-agent";

  return "human-vs-human";
}

function tauntFor(
  matchup: MatchupKind,
  seed: string,
  youWon: boolean | null,
  winnerName: string | null,
  loserName: string | null,
): string {
  const w = winnerName ?? "Winner";
  const l = loserName ?? "Loser";

  switch (matchup) {
    case "draw":
      return stablePick(DRAW_LINES, seed);
    case "agent-beat-human": {
      const base = stablePick(AGENT_BEAT_HUMAN, seed);

      if (youWon === true) return `${base} (That's you. Be nice… or don't.)`;

      if (youWon === false) return base;

      return base;
    }

    case "human-beat-agent": {
      const base = stablePick(HUMAN_BEAT_AGENT, seed);

      if (youWon === true) return base;

      if (youWon === false) return `${base} ${w} outplayed the silicon.`;

      return base;
    }

    case "agent-vs-agent": {
      const base = stablePick(AGENT_VS_AGENT, seed);

      // Name-drop the roast for the agent-on-agent bit
      return `${w} just dunked on ${l}. ${base}`;
    }

    case "human-vs-human": {
      const base = stablePick(HUMAN_VS_HUMAN, seed);

      return `${w} over ${l}. ${base}`;
    }

    default:
      return stablePick(UNKNOWN_LINES, seed);
  }
}

/**
 * Resolve a winner id from common projected fields across games.
 */
function resolveWinnerId(state: {
  winner?: string | null;
  handRanking?: Array<{ playerId?: string }> | null;
  lastHandResult?: { winners?: string[] } | null;
}): string | null {
  const w = state.winner;

  if (isString(w) && w.length > 0) {
    if (w === "draw") return "draw";

    return w;
  }

  const rank0 = state.handRanking?.[0]?.playerId;

  if (rank0) return rank0;
  const poker = state.lastHandResult?.winners;

  if (Array.isArray(poker) && poker.length === 1 && poker[0]) return poker[0];

  return null;
}

export function buildGameOverCopy(opts: {
  winner?: string | null;
  players?: GamePlayer[] | null;
  youId?: string | null;
  /** Optional extra seed so different games don't always pick the same line */
  seedExtra?: string;
  handRanking?: Array<{ playerId?: string }> | null;
  lastHandResult?: { winners?: string[] } | null;
}): GameOverCopy {
  const players = opts.players ?? [];
  const youId = opts.youId ?? null;

  const winnerRaw =
    opts.winner != null && opts.winner !== ""
      ? opts.winner
      : resolveWinnerId({
          winner: opts.winner,
          handRanking: opts.handRanking,
          lastHandResult: opts.lastHandResult,
        });

  if (winnerRaw === "draw") {
    const seed = `draw|${youId ?? ""}|${opts.seedExtra ?? ""}`;

    return {
      headline: "DRAW",
      winnerLine: "Nobody wins — board is full of mutual disappointment.",
      taunt: stablePick(DRAW_LINES, seed),
      matchup: "draw",
      winnerId: null,
      winnerName: null,
      loserName: null,
    };
  }

  const winnerId = winnerRaw;

  const winner = winnerId ? (players.find((p) => p.id === winnerId) ?? null) : null;

  const losers = winnerId ? players.filter((p) => p.id !== winnerId) : [];

  // Prefer a single opponent for 1v1 taunts; otherwise first non-winner.
  const loser = losers.length === 1 ? losers[0]! : (losers[0] ?? null);

  const winnerName = winner ? playerDisplayName(winner) : winnerId ? winnerId.slice(0, 8) : null;

  const loserName = loser ? playerDisplayName(loser) : null;

  const youAreWinner = Boolean(youId && winnerId && youId === winnerId);

  const youAreLoser = Boolean(
    youId && winnerId && youId !== winnerId && players.some((p) => p.id === youId),
  );

  const perspective: boolean | null = youAreWinner ? true : youAreLoser ? false : null;

  const headline = !winnerId
    ? "GAME OVER"
    : youAreWinner
      ? "YOU WIN"
      : youAreLoser
        ? "YOU LOSE"
        : "GAME OVER";

  let winnerLine: string | null = null;

  if (winnerId && winnerName) {
    if (youAreWinner) {
      winnerLine = loserName ? `You beat ${loserName}` : "You take the W";
    } else if (youAreLoser) {
      winnerLine = `${winnerName} wins`;
    } else {
      winnerLine = loserName ? `${winnerName} beats ${loserName}` : `${winnerName} wins`;
    }
  }

  const matchup: MatchupKind = !winnerId
    ? "unknown"
    : kindFor(isAgentSeat(winner), loser ? isAgentSeat(loser) : null);

  // Tag agent/human in winner line for clarity when not first-person only
  if (winnerLine && winner && loser && matchup !== "unknown") {
    const wTag = isAgentSeat(winner) ? "agent" : "human";
    const lTag = isAgentSeat(loser) ? "agent" : "human";

    if (matchup === "agent-beat-human" || matchup === "human-beat-agent") {
      if (youAreWinner) {
        winnerLine = `You (${wTag}) beat ${loserName} (${lTag})`;
      } else if (youAreLoser) {
        winnerLine = `${winnerName} (${wTag}) beats you (${lTag})`;
      } else {
        winnerLine = `${winnerName} (${wTag}) beats ${loserName} (${lTag})`;
      }
    } else if (matchup === "agent-vs-agent") {
      winnerLine = youAreWinner
        ? `You roast ${loserName}`
        : youAreLoser
          ? `${winnerName} roasts you`
          : `${winnerName} roasts ${loserName}`;
    }
  }

  const seed = [
    winnerId ?? "none",
    loser?.id ?? "",
    youId ?? "",
    matchup,
    opts.seedExtra ?? "",
  ].join("|");

  const taunt = tauntFor(matchup, seed, perspective, winnerName, loserName);

  return {
    headline,
    winnerLine,
    taunt,
    matchup,
    winnerId,
    winnerName,
    loserName,
  };
}
