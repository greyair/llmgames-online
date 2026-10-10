/** Public series records contain participant references, never agent credentials. */
export const SERIES_GAMES = [
  "connect4",
  "checkers",
  "reversi",
  "pokemon",
  "battleship",
  "poker",
  "contexto",
] as const;

export const SERIES_DEFAULT_MATCH_TIME = 900_000;

export const SERIES_DEFAULT_TURN_TIME = 90_000;

export type SeriesGame = (typeof SERIES_GAMES)[number];

export interface SeriesRound {
  gameType: SeriesGame;
  repeats: number;
  gameTotalTime: number;
  turnTime: number;
}

export interface SeriesConfig {
  name: string;
  rounds: SeriesRound[];
  firstSeat: "alternate" | "participant1" | "participant2" | "random";
  gapMs: number;
  progression: "automatic" | "ready";
}

export interface SeriesParticipant {
  id: string;
  name: string;
  kind: "human" | "agent";
  environmentLabel?: string;
  modelLabel: string;
  promptLabel: string;
}

export interface SeriesMetric {
  actions: number;
  decisionMs: number;
  timeouts: number;
}

export interface SeriesResult {
  index: number;
  gameType: SeriesGame;
  gameId: string;
  firstParticipantId: string | null;
  winnerId: string | null;
  outcome: "win" | "draw" | "aborted";
  reason: string;
  startedAt: number;
  endedAt: number;
  metrics: Record<string, SeriesMetric>;
}

export interface SeriesMatch {
  index: number;
  gameType: SeriesGame;
  roomId: string;
  roomCode: string;
  firstParticipantId: string;
  players: Array<{ participantId: string; playerId: string }>;
  createdAt: number;
}

export interface SeriesView {
  code: string;
  config: SeriesConfig;
  status: "waiting" | "preparing" | "playing" | "break" | "completed" | "cancelled" | "failed";
  participants: SeriesParticipant[];
  results: SeriesResult[];
  currentMatch: SeriesMatch | null;
  nextAt: number | null;
  ready: string[];
  totalMatches: number;
  createdAt: number;
  expiresAt: number;
  error?: string;
  isHost: boolean;
  you: string | null;
}

export function expandSeries(config: SeriesConfig): SeriesRound[] {
  return config.rounds.flatMap((round) => Array.from({ length: round.repeats }, () => round));
}

export function seriesStandings(view: Pick<SeriesView, "participants" | "results">) {
  return SERIES_GAMES.flatMap((gameType) => {
    if (!view.results.some((result) => result.gameType === gameType)) return [];

    return [
      {
        gameType,
        participants: view.participants.map((participant) => {
          const results = view.results.filter(
            (result) => result.gameType === gameType && result.outcome !== "aborted",
          );

          const metrics = results.map((result) => result.metrics[participant.id]);
          const actions = metrics.reduce((sum, metric) => sum + (metric?.actions ?? 0), 0);

          return {
            ...participant,
            wins: results.filter((result) => result.winnerId === participant.id).length,
            draws: results.filter((result) => result.outcome === "draw").length,
            losses: results.filter(
              (result) => result.outcome === "win" && result.winnerId !== participant.id,
            ).length,
            timeouts: metrics.reduce((sum, metric) => sum + (metric?.timeouts ?? 0), 0),
            averageDecisionMs: actions
              ? metrics.reduce((sum, metric) => sum + (metric?.decisionMs ?? 0), 0) / actions
              : null,
          };
        }),
      },
    ];
  });
}
