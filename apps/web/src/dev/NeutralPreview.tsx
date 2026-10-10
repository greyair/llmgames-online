import { z } from "zod";
import { cardSeatsSchema, pointSchema } from "@/domain/view-contracts";

const slotSchema = z.object({ slot: z.number() });

import { isNumber } from "@llmgames/game-catalog";

import { previewSinking } from "./shipSinkingPreview";

import { FlowPreview } from "./FlowPreview";
import { Landing } from "@/interface/Landing";
import { Setup } from "@/interface/PublicPages";
import { designStates, isFlowState } from "./designPreview";
import { GameBoard } from "@/game-ui/GameBoard";
import { ComponentsPreview } from "./ComponentsPreview";
import "./preview.css";
import { useCallback, useEffect, useState } from "react";
import { fixture } from "./previewFixtures";
import { applyPreviewScenario } from "./previewScenarios";
import { MatchDesk } from "@/game-ui/MatchDesk";
import { Button } from "@/components/ui/button";
import { SiteBar } from "@/interface/Chrome";
import { Library } from "@/interface/Library";
import { Spectator, type PublicMatch } from "@/interface/Spectator";
import { go } from "@/lib/navigate";

export default function NeutralPreview({ screen }: { screen: string }) {
  const [mode, setPreviewMode] = useState(
    () => new URLSearchParams(location.search).get("state") ?? "playing",
  );

  const [previewReplayFrame, setPreviewReplayFrame] = useState<number | null>(null);

  const [previewClock, setPreviewClock] = useState(() => ({
    serverTime: Date.now(),
    receivedAt: performance.now(),
  }));

  const setMode = (value: string) => {
    setPreviewMode(value);
    setPreviewReplayFrame(null);
    setPreviewClock({ serverTime: Date.now(), receivedAt: performance.now() });
  };

  const [demoSinks, setDemoSinks] = useState(0);

  const sinkControls = (
    <>
      <button disabled={demoSinks >= 2} onClick={() => setDemoSinks((count) => count + 1)}>
        Preview sinking
      </button>
      <button onClick={() => setDemoSinks(0)}>Reset sinking</button>
    </>
  );

  const [demoTurn, setDemoTurn] = useState(0);

  const [animateTurns, setAnimateTurns] = useState(
    () => new URLSearchParams(location.search).get("animate") === "true",
  );

  useEffect(() => {
    if (screen !== "spectator" || !animateTurns) return;

    const timer = window.setInterval(() => {
      if (!document.hidden) setDemoTurn((turn) => turn + 1);
    }, 3000);

    return () => window.clearInterval(timer);
  }, [screen, animateTurns]);
  const [playerCount, setPlayerCount] = useState<number | null>(null);
  const [demoBattle, setDemoBattle] = useState<{ own: string; enemy: string }[]>([]);
  const [autoBattle, setAutoBattle] = useState(true);

  const playDemoTurn = useCallback((move?: string) => {
    const ownMoves = ["Flamethrower", "Slash", "Earthquake"];
    const enemyMoves = ["Surf", "Ice Beam", "Body Slam", "Hydro Pump"];
    setDemoBattle((turns) => [
      ...turns,
      {
        own: move ?? ownMoves[Math.floor(Math.random() * ownMoves.length)]!,
        enemy: enemyMoves[Math.floor(Math.random() * enemyMoves.length)]!,
      },
    ]);
  }, []);

  useEffect(() => {
    const pokemonPlayer = screen === "pokemon" && mode === "playing";

    const pokemonSpectator =
      screen === "spectator" && (mode === "watch-pokemon" || mode === "watching-pokemon");

    if ((!pokemonPlayer && !pokemonSpectator) || !autoBattle) return;
    const start = window.setTimeout(() => playDemoTurn(), 1200);

    const repeat = window.setInterval(() => {
      if (!document.hidden) playDemoTurn();
    }, 6500);

    return () => {
      window.clearTimeout(start);
      window.clearInterval(repeat);
    };
  }, [screen, mode, autoBattle, playDemoTurn]);
  const [action, setAction] = useState("Seeded demo · No live room");
  const [demoImpacts, setDemoImpacts] = useState<{ row: number; col: number; hit: boolean }[]>([]);
  const [demoMines, setDemoMines] = useState<{ row: number; col: number }[]>([]);
  const [demoBombs, setDemoBombs] = useState<{ row: number; col: number }[]>([]);

  const [demoScans, setDemoScans] = useState<
    { row: number; col: number; shipCells: number; cellsScanned: number }[]
  >([]);

  if (screen === "landing") return <Landing />;

  if (screen === "connect-ai") return <Setup />;

  if (["profile", "history", "agent-log", "setup"].includes(screen) || isFlowState(mode))
    return <FlowPreview screen={screen} mode={mode} />;
  const state = applyPreviewScenario(fixture(screen), screen, mode);

  if (screen === "poker") {
    const running = state.status === "playing";

    const deciding =
      running &&
      !["hand_over", "showdown", "ended", "waiting"].includes(state.turnState?.phase ?? "");

    state.clockReceivedAt = previewClock.receivedAt;
    state.clock = {
      serverTime: previewClock.serverTime,
      gameEndsAt: running ? previewClock.serverTime + (state.gameTimeRemaining ?? 0) : null,
      turnEndsAt: deciding
        ? previewClock.serverTime + (state.turnState?.turnTimeRemaining ?? 0)
        : null,
    };
    state.timerConfig = { ...state.timerConfig, turnTime: 45000 };
  }

  if (screen !== "poker") {
    const running = state.status === "playing";
    state.clockReceivedAt = previewClock.receivedAt;
    state.clock = {
      serverTime: previewClock.serverTime,
      gameEndsAt:
        running && isNumber(state.gameTimeRemaining)
          ? previewClock.serverTime + state.gameTimeRemaining
          : null,
      turnEndsAt:
        running && isNumber(state.turnState?.turnTimeRemaining)
          ? previewClock.serverTime + state.turnState.turnTimeRemaining
          : null,
    };
  }

  if (screen === "contexto" && playerCount !== null) {
    state.players = state.players?.slice(0, playerCount);
    state.maxPlayers = playerCount;
  }

  if (screen === "poker" && playerCount !== null) {
    const full = applyPreviewScenario(
      fixture(screen),
      screen,
      ["heads-up", "3-players", "4-players", "5-players"].includes(mode) ? "playing" : mode,
    );

    state.seats = cardSeatsSchema.parse(full.seats).slice(0, playerCount);
    state.players = full.players?.slice(0, playerCount);
    state.maxPlayers = playerCount;
    const ids = new Set(cardSeatsSchema.parse(state.seats).map((seat) => seat.playerId));

    if (state.turnState?.currentPlayerId && !ids.has(state.turnState.currentPlayerId))
      state.turnState = { ...state.turnState, currentPlayerId: state.players?.[0]?.id ?? null };

    if (playerCount === 2) {
      state.smallBlindPlayerId = state.players?.[0]?.id;
      state.bigBlindPlayerId = state.players?.[1]?.id;
    }
  }

  if (screen === "poker" && Array.isArray(state.seats))
    state.seats = state.seats.map((seat, index) => {
      const next = { ...seat };

      if (mode === "playing") next.folded = index === 2 || index === 4;

      return next;
    });

  // Preview-only markers let designers inspect a mine after dropping it.
  // Live gameplay still renders only the server's projected board.
  if (screen === "battleship" && state.yourBoard && !state.you?.isSpectator) {
    const board = state.yourBoard;
    state.yourBoard = { ...board, mines: [...(board.mines ?? []), ...demoMines] };

    const opponent = state.opponent ?? {};

    state.opponent = {
      ...opponent,
      bombedAreas: [...(opponent.bombedAreas ?? []), ...demoBombs],
      radarScans: [...(opponent.radarScans ?? state.radarScans ?? []), ...demoScans],
    };

    if (demoScans.length) {
      state.radarScans = [...(state.radarScans ?? []), ...demoScans];
      state.lastAnnouncement = "Radar contact: 2 ship cell(s) in the 3×3.";
    }
  }

  if (screen === "battleship" && demoImpacts.length && !state.you?.isSpectator) {
    const shots = Array.isArray(state.shotLog) ? state.shotLog : [];
    state.shotLog = [
      ...shots,
      ...demoImpacts.map((point, index) => ({
        ...point,
        sequence: shots.length + index + 1,
        byPlayerId: state.you?.playerId ?? "preview-0",
        weapon: "cannon",
      })),
    ];

    const opponent = state.opponent ?? {};

    state.opponent = {
      ...opponent,
      hits: [...(opponent.hits ?? []), ...demoImpacts.filter((p) => p.hit)],
      misses: [...(opponent.misses ?? []), ...demoImpacts.filter((p) => !p.hit)],
    };
  }

  if (screen === "pokemon" && demoBattle.length) {
    state.battleLog = [
      ...(state.battleLog ?? []),
      ...demoBattle.flatMap((turn, i) => [
        "|turn|" + (5 + i),
        "|move|p1a: Charizard|" +
          turn.own +
          "|" +
          (turn.own === "Swords Dance" ? "p1a: Charizard" : "p2a: Blastoise"),
        turn.own === "Swords Dance"
          ? "|-boost|p1a: Charizard|atk|2"
          : "|-damage|p2a: Blastoise|50/100",
        "|move|p2a: Blastoise|" + turn.enemy + "|p1a: Charizard",
        "|-damage|p1a: Charizard|200/300",
      ]),
    ];
    state.battleTurn = 4 + demoBattle.length;
    state.sides = (state.sides ?? []).map((side) => ({
      ...side,
      pokemon: side.pokemon.map((mon) =>
        mon.active ? { ...mon, condition: side.seat === "p1" ? "200/300" : "50/100" } : mon,
      ),
    }));
  }

  if (screen === "battleship") previewSinking(state, demoSinks);
  const Board = GameBoard;

  if (screen === "spectator") {
    if (mode === "loading")
      return (
        <Spectator
          rooms={[]}
          selectedId="preview-loading"
          renderBoard={(view) => <GameBoard state={view} />}
        />
      );

    const rooms: PublicMatch[] = [
      "contexto",
      "connect4",
      "checkers",
      "reversi",
      "codenames",
      "poker",
      "pokemon",
      "battleship",
    ].flatMap((game) =>
      ["playing", "waiting", "ended"].map((status) => ({
        ...applyPreviewScenario(fixture(game), game, "spectator"),
        status,
        broadcastId: `${game}-${status}`,
      })),
    );

    if (
      mode === "watching" ||
      mode === "creating" ||
      mode === "finished" ||
      mode.startsWith("watch-")
    ) {
      const games = [
        "contexto",
        "connect4",
        "battleship",
        "codenames",
        "checkers",
        "reversi",
        "pokemon",
        "poker",
      ];

      const requested = mode.replace(/^watch-/, "").replace(/^contexto(?=-|$)/, "contexto");

      const game =
        games.find((id) => requested === id || requested.startsWith(id + "-")) ?? "connect4";

      const variant =
        mode === "creating"
          ? "lobby-waiting"
          : mode === "finished"
            ? "win"
            : requested.slice(game.length + 1) || "playing";

      let view = applyPreviewScenario(
        applyPreviewScenario(fixture(game), game, variant),
        game,
        mode === "finished" ? "spectator-ended" : "spectator",
      );

      if (game === "contexto") view = applyPreviewScenario(view, game, "broadcast");

      if (game === "contexto" && playerCount !== null) {
        view.players = view.players?.slice(0, playerCount);
        const ids = new Set(view.players?.map((player) => player.id));
        view.progress = Object.fromEntries(
          Object.entries(view.progress ?? {}).filter(([id]) => ids.has(id)),
        );
        view.maxPlayers = playerCount;
      }

      if (game === "pokemon" && demoBattle.length) {
        view.battleLog = [
          ...(view.battleLog ?? []),
          ...demoBattle.flatMap((turn, i) => [
            "|turn|" + (5 + i),
            "|move|p1a: Charizard|" +
              turn.own +
              "|" +
              (turn.own === "Swords Dance" ? "p1a: Charizard" : "p2a: Blastoise"),
            turn.own === "Swords Dance"
              ? "|-boost|p1a: Charizard|atk|2"
              : "|-damage|p2a: Blastoise|50/100",
            "|move|p2a: Blastoise|" + turn.enemy + "|p1a: Charizard",
            "|-damage|p1a: Charizard|200/300",
          ]),
        ];
        view.battleTurn = 4 + demoBattle.length;
        view.sides = (view.sides ?? []).map((side) => ({
          ...side,
          pokemon: side.pokemon.map((mon) =>
            mon.active ? { ...mon, condition: side.seat === "p1" ? "200/300" : "50/100" } : mon,
          ),
        }));
      }

      if (game === "battleship") previewSinking(view, demoSinks);

      if (demoTurn && view.status === "playing" && view.turnState) {
        const players = view.players ?? [];

        const initial = Math.max(
          0,
          players.findIndex((player) => player.id === view.turnState?.currentPlayerId),
        );

        view.turnState = {
          ...view.turnState,
          turnNumber: view.turnState.turnNumber + demoTurn,
          currentPlayerId: players[(initial + demoTurn) % players.length]?.id ?? null,
        };
      }

      return (
        <>
          <MatchDesk broadcast state={view} onExit={() => go("/design-preview/spectator")}>
            <GameBoard state={view} />
          </MatchDesk>
          <details className="preview-console">
            <summary>Demo controls</summary>
            <div>
              {game === "contexto" && (
                <label>
                  Players{" "}
                  <select
                    aria-label="Number of stream players"
                    value={view.players?.length ?? 6}
                    onChange={(event) => setPlayerCount(Number(event.target.value))}
                  >
                    {[1, 2, 3, 4, 5, 6].map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {game === "battleship" && sinkControls}
              <button
                onClick={() =>
                  game === "pokemon" ? playDemoTurn() : setDemoTurn((turn) => turn + 1)
                }
              >
                {game === "pokemon" ? "Preview battle animation" : "Preview move change"}
              </button>
              {game === "pokemon" ? (
                <label>
                  <input
                    type="checkbox"
                    checked={autoBattle}
                    onChange={(event) => setAutoBattle(event.target.checked)}
                  />{" "}
                  Auto battle
                </label>
              ) : (
                <label>
                  <input
                    type="checkbox"
                    checked={animateTurns}
                    onChange={(event) => setAnimateTurns(event.target.checked)}
                  />{" "}
                  Auto turns
                </label>
              )}
            </div>
          </details>
        </>
      );
    }

    return (
      <Spectator
        rooms={mode === "empty" ? [] : rooms}
        renderBoard={(view) => <GameBoard state={view} />}
      />
    );
  }

  if (screen === "components") return <ComponentsPreview />;

  if (screen === "library")
    return <Library onJoin={() => go("/design-preview/connect4?state=lobby-guest")} />;

  const previewFrame =
    previewReplayFrame === null
      ? state
      : { ...(previewReplayFrame === 0 ? fixture(screen) : state), replayReadOnly: true };

  const previewControls =
    state.status === "ended" ? (
      <div className="room-controls">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPreviewReplayFrame(previewReplayFrame === null ? 0 : null)}
        >
          {previewReplayFrame === null ? "Watch replay" : "Back to result"}
        </Button>
        {previewReplayFrame !== null && (
          <label>
            Move {previewReplayFrame + 1} of 2
            <input
              aria-label="Replay position"
              type="range"
              min={0}
              max={1}
              value={previewReplayFrame}
              onChange={(event) => setPreviewReplayFrame(Number(event.target.value))}
            />
          </label>
        )}
      </div>
    ) : undefined;

  return (
    <div
      className={
        state.status === "ended" && previewReplayFrame === null ? "preview-result-shell" : undefined
      }
    >
      {state.status === "ended" && previewReplayFrame === null && <SiteBar authenticated />}
      <MatchDesk
        state={previewFrame}
        finalReveal={state.status === "ended" ? state : undefined}
        controls={previewControls}
        onExit={() => go("/design-preview/library")}
      >
        <Board
          state={previewFrame}
          send={(name, data) => {
            setAction(`${name} ${JSON.stringify(data)}`);

            if (screen === "pokemon" && name === "pokemon_move" && mode === "playing") {
              const choice = state.decision?.moves.find(
                (move) => move.slot === slotSchema.parse(data).slot,
              );

              if (choice) playDemoTurn(choice.name);
            }

            if (screen === "battleship" && name === "bomb")
              setDemoBombs((previous) => [...previous, pointSchema.parse(data)]);

            if (screen === "battleship" && name === "mine") {
              const cell = pointSchema.parse(data);
              setDemoMines((previous) => [...previous, cell]);
            }

            if (screen === "battleship" && name === "radar") {
              const cell = pointSchema.parse(data);
              setDemoScans((previous) => [
                ...previous,
                {
                  ...cell,
                  shipCells: 2,
                  cellsScanned:
                    (Math.min(9, cell.row + 1) - Math.max(0, cell.row - 1) + 1) *
                    (Math.min(9, cell.col + 1) - Math.max(0, cell.col - 1) + 1),
                },
              ]);
            }
          }}
        />
      </MatchDesk>
      <details className="preview-console">
        <summary>Demo controls</summary>
        <div>
          <select
            aria-label="Demo state"
            value={mode}
            onChange={(event) => {
              setMode(event.target.value);
              setPlayerCount(null);
              setDemoMines([]);
              setDemoBombs([]);
              setDemoScans([]);
              setDemoImpacts([]);
              setDemoBattle([]);
              setDemoSinks(0);
            }}
          >
            {designStates(screen).map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          {(screen === "poker" || screen === "contexto") && (
            <label>
              Players{" "}
              <select
                aria-label="Number of players"
                value={
                  screen === "contexto"
                    ? (state.players?.length ?? 6)
                    : Array.isArray(state.seats)
                      ? state.seats.length
                      : 6
                }
                onChange={(event) => setPlayerCount(Number(event.target.value))}
              >
                {(screen === "contexto" ? [1, 2, 3, 4, 5, 6] : [2, 3, 4, 5, 6]).map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
          )}
          {screen === "pokemon" && (
            <>
              <button onClick={() => playDemoTurn()}>Preview animations</button>
              <label>
                <input
                  type="checkbox"
                  checked={autoBattle}
                  onChange={(event) => setAutoBattle(event.target.checked)}
                />{" "}
                Auto battle
              </label>
            </>
          )}
          {screen === "battleship" && (
            <>
              {sinkControls}
              <button
                onClick={() => setDemoImpacts((old) => [...old, { row: 3, col: 7, hit: true }])}
              >
                Preview hit
              </button>
              <button
                onClick={() => setDemoImpacts((old) => [...old, { row: 3, col: 8, hit: false }])}
              >
                Preview miss
              </button>
            </>
          )}
          <output aria-label="Demo action">{action}</output>
        </div>
      </details>
    </div>
  );
}
