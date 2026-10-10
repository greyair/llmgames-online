import { shotsSchema } from "@/domain/view-contracts";
import type { ClientView } from "@/domain/game-state";

export type ReplayTimelineFrame = {
  index: number;
  label: string;
  state: ClientView;
};

export type ReplaySoundKind =
  | "start"
  | "deal"
  | "card"
  | "drop"
  | "flip"
  | "chip"
  | "click"
  | "cancel"
  | "clue"
  | "reveal"
  | "cannon"
  | "bomb"
  | "radar"
  | "torpedo"
  | "hit"
  | "miss"
  | "sink"
  | "timeout"
  | "win"
  | "draw";

export type ReplaySoundEvent = {
  at: number;
  kind: ReplaySoundKind;
};

export type ReplayTimelineEntry<TFrame extends ReplayTimelineFrame> = {
  frame: TFrame;
  timestamp: number;
  duration: number;
  sounds: ReplaySoundEvent[];
};

export type ReplayTimeline<TFrame extends ReplayTimelineFrame> = {
  entries: Array<ReplayTimelineEntry<TFrame>>;
  duration: number;
  sounds: ReplaySoundEvent[];
};

const INTRO_DURATION = 1.6;

const ACTION_DURATION = 1;

const OUTRO_DURATION = 2.4;

function replayFrameDuration(label: string, index: number, total: number): number {
  if (index === 0 || label === "game_started") return INTRO_DURATION;

  if (index === total - 1 || label === "game_ended") return OUTRO_DURATION;

  return ACTION_DURATION;
}

function battleShots(state: ClientView | undefined): ScoreShot[] {
  return shotsSchema.safeParse(state?.shotLog).data ?? [];
}

function gameEndedSound(state: ClientView): ReplaySoundKind {
  return state.winner === "draw" ? "draw" : "win";
}

function primarySound(label: string, state: ClientView): ReplaySoundKind {
  switch (label) {
    case "game_started":
      return "start";
    case "deal":
    case "next_hand":
    case "place_fleet":
    case "placement_timeout":
      return "deal";
    case "drop_disc":
      return "drop";
    case "place_disc":
      return "flip";
    case "bet":
    case "raise":
    case "call":
    case "all_in":
      return "chip";
    case "fold":
      return "cancel";
    case "give_clue":
      return "clue";
    case "guess_word":
      return "reveal";
    case "cannon":
      return "cannon";
    case "bomb":
      return "bomb";
    case "radar":
      return "radar";
    case "torpedo":
      return "torpedo";
    case "turn_timeout":
      return "timeout";
    case "game_ended":
      return gameEndedSound(state);
    default:
      return "click";
  }
}

function resultSounds(
  label: string,
  state: ClientView,
  previousState: ClientView | undefined,
  at: number,
): ReplaySoundEvent[] {
  if (label !== "cannon" && label !== "bomb" && label !== "torpedo") return [];
  const previousShots = battleShots(previousState);

  const shots = latestRoundShots(battleShots(state), latestShotSequence(previousShots));

  if (shots.length === 0) return [];

  if (shots.some((shot) => shot.sunkShipId)) {
    return [{ at: at + 0.42, kind: "sink" }];
  }

  return [
    {
      at: at + 0.34,
      kind: shots.some((shot) => shot.hit) ? "hit" : "miss",
    },
  ];
}

export function buildReplayTimeline<TFrame extends ReplayTimelineFrame>(
  frames: TFrame[],
): ReplayTimeline<TFrame> {
  let timestamp = 0;

  const entries = frames.map((frame, index) => {
    const duration = replayFrameDuration(frame.label, index, frames.length);
    const cueAt = timestamp + Math.min(0.18, duration / 4);

    const sounds: ReplaySoundEvent[] = [
      { at: cueAt, kind: primarySound(frame.label, frame.state) },
      ...resultSounds(frame.label, frame.state, frames[index - 1]?.state, cueAt),
    ];

    const entry: ReplayTimelineEntry<TFrame> = {
      frame,
      timestamp,
      duration,
      sounds,
    };

    timestamp += duration;

    return entry;
  });

  return {
    entries,
    duration: timestamp,
    sounds: entries.flatMap((entry) => entry.sounds),
  };
}

export function replayFilename(gameType: string, now = new Date()): string {
  const date = now
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "Z");

  const game = gameType
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return `llm-games-${game || "replay"}-${date}.mp4`;
}

import { latestRoundShots, latestShotSequence, type ScoreShot } from "@/features/battleship/score";
