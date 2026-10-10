import { pointSchema } from "@/domain/view-contracts";
import { knownValue } from "@/domain/view-contracts";
import type { WireValue } from "@llmgames/game-catalog";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ClientView } from "@/domain/game-state";
import { playGameSound, type GameSound } from "@/interface/Feedback";

type Point = { row: number; col: number };

type Effect = Point & {
  id: number;
  board: string;
  kind: GameSound;
  direction?: string;
  sunkShipId?: string;
  shipName?: string;
};

/** Only new projected results produce hit/miss effects. Mounting or reconnecting stays quiet. */
export function useBattleshipEffects(state: ClientView) {
  const [effects, setEffects] = useState<Effect[]>([]);
  const [pendingRadar, setPendingRadar] = useState(0);

  const spectatorBoards = state.spectatorBoards ?? [];

  const incomingRadarByBoard: Record<string, Point[]> = state.you?.isSpectator
    ? {
        own: spectatorBoards[0]?.radarScans ?? [],
        target: spectatorBoards[1]?.radarScans ?? [],
      }
    : {
        own: state.yourBoard?.radarScans ?? [],
      };

  const incomingRadarCounts = Object.fromEntries(
    Object.entries(incomingRadarByBoard).map(([board, scans]) => [board, scans.length]),
  );

  const [seenIncomingRadar, setSeenIncomingRadar] =
    useState<Record<string, number>>(incomingRadarCounts);

  const [visibleRadarCounts, setVisibleRadarCounts] =
    useState<Record<string, number>>(incomingRadarCounts);

  const [pendingIncomingRadar, setPendingIncomingRadar] = useState(0);

  const hasFreshIncomingRadar = Object.entries(incomingRadarCounts).some(
    ([board, count]) => count > (seenIncomingRadar[board] ?? 0),
  );

  const nextId = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const seen = useRef<number | null>(null);
  const previousMines = useRef<Set<string> | null>(null);
  const previousAnnouncement = useRef(state.lastAnnouncement);

  const add = (
    kind: GameSound,
    board: string,
    point: Point & {
      direction?: string;
      sunkShipId?: string;
      shipName?: string;
    },
    delay = 0,
    onComplete?: () => void,
  ) => {
    const timer = setTimeout(() => {
      const id = ++nextId.current;
      setEffects((old) => [...old.slice(-19), { id, kind, board, ...point }]);
      playGameSound(kind);

      if (kind === "radar")
        for (const delay of [1000, 2000])
          timers.current.push(setTimeout(() => playGameSound("radar"), delay));

      const cleanup = setTimeout(
        () => {
          setEffects((old) => old.filter((effect) => effect.id !== id));
          onComplete?.();
        },
        kind === "radar" ? 3100 : kind === "sunk" ? 2500 : 1100,
      );

      timers.current.push(cleanup);
    }, delay);

    timers.current.push(timer);
  };

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );
  useEffect(() => {
    const shots = (state.shotLog ?? []).map((shot, index) => ({
      ...shot,
      sequence: shot.sequence ?? index + 1,
    }));

    const latest = Math.max(0, ...shots.map((shot) => shot.sequence));

    if (seen.current === null || latest < seen.current) {
      seen.current = latest;

      return;
    }

    const fresh = shots.filter((shot) => shot.sequence > seen.current!);
    seen.current = latest;

    if (state.replayReadOnly) return;
    fresh.slice(-12).forEach((shot, index) => {
      const firstSpectatorBoard = state.spectatorBoards?.[0]?.playerId;

      const board = state.you?.isSpectator
        ? shot.byPlayerId === firstSpectatorBoard
          ? "own"
          : "target"
        : shot.byPlayerId === state.you?.playerId
          ? "target"
          : "own";

      const name = state.fleet?.find((ship) => ship.id === shot.sunkShipId);

      add(
        shot.sunkShipId ? "sunk" : shot.hit ? "hit" : "miss",
        board,
        { ...shot, shipName: name?.shortName ?? name?.name ?? "Ship" },
        index * 65,
      );
    });
  }, [state.shotLog, state.you?.playerId, state.you?.isSpectator, state.replayReadOnly]);
  useEffect(() => {
    const mines = state.yourBoard?.mines ?? [];

    const keys = new Set(mines.map((p) => `${p.row}:${p.col}`));

    if (previousMines.current && !state.replayReadOnly)
      for (const point of mines)
        if (!previousMines.current.has(`${point.row}:${point.col}`)) add("mine", "own", point);

    if (previousMines.current && !state.replayReadOnly)
      for (const key of previousMines.current)
        if (!keys.has(key)) {
          const [row, col] = key.split(":").map(Number);
          add("mine", "own", { row: row!, col: col! });
        }

    previousMines.current = keys;
  }, [state.yourBoard, state.replayReadOnly]);
  useEffect(() => {
    const nextSeen = { ...seenIncomingRadar };

    for (const [board, scans] of Object.entries(incomingRadarByBoard)) {
      const previous = seenIncomingRadar[board] ?? 0;

      if (scans.length < previous || state.replayReadOnly) {
        nextSeen[board] = scans.length;
        setVisibleRadarCounts((counts) => ({
          ...counts,
          [board]: scans.length,
        }));
        continue;
      }

      const fresh = scans.slice(previous);
      nextSeen[board] = scans.length;

      if (!fresh.length) continue;
      setPendingIncomingRadar((count) => count + fresh.length);
      fresh.forEach((scan, index) =>
        add("radar", board, scan, index * 65, () => {
          setVisibleRadarCounts((counts) => ({
            ...counts,
            [board]: Math.min(scans.length, (counts[board] ?? previous) + 1),
          }));
          setPendingIncomingRadar((count) => Math.max(0, count - 1));
        }),
      );
    }

    if (Object.entries(nextSeen).some(([board, count]) => count !== seenIncomingRadar[board]))
      setSeenIncomingRadar(nextSeen);
  }, [state.yourBoard, state.spectatorBoards, state.replayReadOnly, seenIncomingRadar]);
  useEffect(() => {
    if (
      previousAnnouncement.current !== state.lastAnnouncement &&
      state.lastAnnouncement?.includes("Mines triggered") &&
      !state.replayReadOnly
    )
      playGameSound("mine");
    previousAnnouncement.current = state.lastAnnouncement;
  }, [state.lastAnnouncement, state.replayReadOnly]);

  const launch = (name: string, data: WireValue) => {
    const point = pointSchema.safeParse(data).data;

    if (!point) return;

    if (!Number.isInteger(point?.row) || !Number.isInteger(point?.col)) return;

    if (name === "mine") return; // Wait for the server's placed mine.

    if (name === "radar") {
      setPendingRadar((count) => count + 1);
      add("radar", "target", point, 0, () => setPendingRadar((count) => Math.max(0, count - 1)));

      return;
    }

    if (name === "cannon" || name === "bomb" || name === "torpedo")
      add(name === "cannon" ? "shot" : name, "target", point);
  };

  return {
    effects,
    launch,
    radarScanning: pendingRadar > 0,
    incomingRadarScanning: pendingIncomingRadar > 0 || hasFreshIncomingRadar,
    visibleRadarCounts,
  };
}

const torpedoTurn = { n: 180, e: -90, w: 90, s: 0 } satisfies Record<string, number>;

function wakeStyle(effect: Effect) {
  const { row, col, direction = "s" } = effect;

  if (direction === "s" || direction === "n")
    return {
      left: `${col * 10}%`,
      top: direction === "s" ? `${row * 10}%` : "0%",
      width: "10%",
      height: direction === "s" ? `${(10 - row) * 10}%` : `${(row + 1) * 10}%`,
    };

  return {
    left: direction === "e" ? `${col * 10}%` : "0%",
    top: `${row * 10}%`,
    width: direction === "e" ? `${(10 - col) * 10}%` : `${(col + 1) * 10}%`,
    height: "10%",
  };
}

function EffectArt({ effect }: { effect: Effect }) {
  switch (effect.kind) {
    case "shot":
      return (
        <>
          <path className="fx-trail" d="M50 -60 50 44" />
          <circle className="fx-shell" cx="50" cy="50" r="7" />
          <circle className="fx-flash" cx="50" cy="50" r="22" />
        </>
      );
    case "miss":
      return (
        <>
          <circle className="fx-ring" cx="50" cy="50" r="16" />
          <circle className="fx-ring fx-ring-late" cx="50" cy="50" r="16" />
          <circle className="fx-drop" cx="50" cy="50" r="5" />
        </>
      );
    case "bomb":
      return (
        <>
          <rect className="fx-blast" x="12" y="12" width="76" height="76" rx="14" />
          <circle className="fx-shock" cx="50" cy="50" r="30" />
          <circle className="fx-shock fx-shock-late" cx="50" cy="50" r="30" />
        </>
      );
    case "radar":
      return (
        <>
          <circle className="fx-radar-grid" cx="50" cy="50" r="46" />
          <circle className="fx-radar-grid" cx="50" cy="50" r="28" />
          <path className="fx-radar-sweep" d="M50 50 50 4A46 46 0 0 1 89.8 27Z" />
          <circle className="fx-radar-pulse" cx="50" cy="50" r="46" />
          <circle className="fx-radar-pulse" cx="50" cy="50" r="46" />
          <circle className="fx-radar-pulse" cx="50" cy="50" r="46" />
          <circle className="fx-radar-core" cx="50" cy="50" r="3" />
        </>
      );
    case "torpedo":
      return (
        <g transform={`rotate(${knownValue(torpedoTurn, effect.direction ?? "s") ?? 0} 50 50)`}>
          <path className="fx-torpedo" d="M50 14c6 0 8 8 8 14v34l-8 12-8-12V28c0-6 2-14 8-14Z" />
          <circle className="fx-ring" cx="50" cy="20" r="18" />
        </g>
      );
    case "mine":
      return (
        <>
          <circle className="fx-shock" cx="50" cy="50" r="30" />
          <path className="fx-mine" d="M50 26 71 38v24L50 74 29 62V38Z" />
          <path
            className="fx-spark"
            d="M50 4v14M50 82v14M4 50h14M82 50h14M17 17l10 10M73 73l10 10M17 83l10-10M73 27l10-10"
          />
        </>
      );
    case "sunk":
      return (
        <>
          <circle className="fx-shock" cx="50" cy="50" r="30" />
          <circle className="fx-bubble" cx="38" cy="58" r="5" />
          <circle className="fx-bubble" cx="60" cy="52" r="4" />
          <circle className="fx-bubble" cx="50" cy="66" r="3" />
        </>
      );
    default:
      return (
        <>
          <path
            className="fx-burst"
            d="m50 8 9 25 25-12-12 25 25 9-25 9 12 25-25-12-9 25-9-25-25 12 12-25L3 59l25-9-12-25 25 12Z"
          />
          <circle className="fx-core" cx="50" cy="50" r="13" />
          {[0, 60, 120, 180, 240, 300].map((angle) => (
            <circle
              key={angle}
              className="fx-ember"
              cx="50"
              cy="50"
              r="3.5"
              style={
                { "--a": `${angle}deg` } satisfies CSSProperties & {
                  [property: `--${string}`]: string | number | undefined;
                }
              }
            />
          ))}
        </>
      );
  }
}

export function BattleshipEffects({ effects, board }: { effects: Effect[]; board: string }) {
  const mine = effects.filter((effect) => effect.board === board);

  return (
    <div className="ships-effects" aria-hidden="true">
      {mine
        .filter((effect) => effect.kind === "sunk")
        .slice(-1)
        .map((effect) => (
          <div key={`label-${effect.id}`} className="ship-sunk-announcement">
            {effect.shipName} sunk
          </div>
        ))}
      {mine
        .filter((effect) => effect.kind === "torpedo")
        .map((effect) => (
          <span
            key={`wake-${effect.id}`}
            className="fx-wake"
            data-direction={effect.direction ?? "s"}
            style={wakeStyle(effect)}
          />
        ))}
      {mine.map((effect) => (
        <svg
          key={effect.id}
          className={`ship-fx fx-${effect.kind}`}
          viewBox="0 0 100 100"
          style={{ left: `${effect.col * 10}%`, top: `${effect.row * 10}%` }}
        >
          <EffectArt effect={effect} />
        </svg>
      ))}
    </div>
  );
}
