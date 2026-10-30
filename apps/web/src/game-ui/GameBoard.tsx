import type { WireValue } from "@llmgames/game-catalog";
import type { ClientView } from "@/domain/game-state";
import { Suspense } from "react";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { LoadingPanel } from "@/components/ui/loading-panel";
import { GameMark } from "@/interface/GameMark";
import { boardFor } from "./boardRegistry";
import "./game-board.css";
import "./sketch/sketch.css";

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

/**
 * Resolve the registered board renderer.
 *
 * Kept outside the component body: the renderer comes from a module-level map,
 * so nothing is created per render, and an unknown id yields `null` for the
 * "unsupported" panel below.
 */
function boardView(state: ClientView, send: BoardProps["send"]) {
  const Renderer = boardFor(state.type);

  return Renderer ? <Renderer state={state} send={send} /> : null;
}

function Board({ state, send }: BoardProps) {
  const t = useT();
  const view = boardView(state, send);

  if (state.status === "waiting")
    return (
      <div className="board-unavailable">
        <GameMark id={state.type ?? ""} size={72} className="board-unavailable-mark" />
        <Badge tone="live">{t("match.startingSoon")}</Badge>
        <h2>{t("match.gettingReady")}</h2>
        <p>{t("match.boardWillAppear")}</p>
      </div>
    );

  if (view) return view;

  return (
    <div className="board-unavailable" role="status">
      <h2>{t("match.unavailable")}</h2>
      <p>{t("match.unsupported")}</p>
    </div>
  );
}
