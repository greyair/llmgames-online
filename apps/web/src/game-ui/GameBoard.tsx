import type { WireValue } from "@llmgames/game-catalog";
import type { ClientView } from "@/domain/game-state";
import { lazy, Suspense } from "react";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { LoadingPanel } from "@/components/ui/loading-panel";
import { GameMark } from "@/interface/GameMark";
import "./game-board.css";
import "./sketch/sketch.css";

const Battleship = lazy(() =>
  import("./Battleship").then(({ Battleship }) => ({ default: Battleship })),
);

const Discs = lazy(() => import("./Discs").then(({ Discs }) => ({ default: Discs })));

const Codenames = lazy(() =>
  import("./Codenames").then(({ Codenames }) => ({ default: Codenames })),
);

const Cards = lazy(() => import("./Cards").then(({ Cards }) => ({ default: Cards })));

const Pokemon = lazy(() => import("./Pokemon").then(({ Pokemon }) => ({ default: Pokemon })));

const Checkers = lazy(() => import("./Checkers").then(({ Checkers }) => ({ default: Checkers })));

const Contexto = lazy(() => import("./Contexto").then(({ Contexto }) => ({ default: Contexto })));

interface BoardProps {
  state: ClientView;
  send: (name: string, data: WireValue) => void;
}

export function GameBoard({
  state,
  send = () => {},
}: {
  state: ClientView;
  send?: (name: string, data: WireValue) => void;
}) {
  const t = useT();

  return (
    <Suspense fallback={<LoadingPanel label={t("match.loadingBoard")} />}>
      <Board state={state} send={send} />
    </Suspense>
  );
}

function Board({ state, send }: BoardProps) {
  const t = useT();

  if (state.status === "waiting")
    return (
      <div className="board-unavailable">
        <GameMark id={state.type ?? ""} size={72} className="board-unavailable-mark" />
        <Badge tone="live">{t("match.startingSoon")}</Badge>
        <h2>{t("match.gettingReady")}</h2>
        <p>{t("match.boardWillAppear")}</p>
      </div>
    );

  if (state.type === "connect4" || state.type === "reversi")
    return <Discs state={state} send={send} />;

  if (state.type === "checkers") return <Checkers state={state} send={send} />;

  if (state.type === "codenames") return <Codenames state={state} send={send} />;

  if (state.type === "poker") return <Cards state={state} send={send} />;

  if (state.type === "battleship") return <Battleship state={state} send={send} />;

  if (state.type === "pokemon") return <Pokemon state={state} send={send} />;

  if (state.type === "contexto") return <Contexto state={state} send={send} />;

  return (
    <div className="board-unavailable" role="status">
      <h2>{t("match.unavailable")}</h2>
      <p>{t("match.unsupported")}</p>
    </div>
  );
}
