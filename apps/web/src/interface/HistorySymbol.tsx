import { Icon } from "@/components/ui/icon";
import { GameMark } from "./GameMark";

/** The game's squircle with a trophy pinned to it when a human took the win. */
export function HistorySymbol({ humanWon, gameType }: { humanWon: boolean; gameType?: string }) {
  return (
    <span
      className={humanWon ? "history-symbol history-symbol-trophy" : "history-symbol"}
      role="img"
      aria-label={humanWon ? "Victory" : "Game"}
    >
      {gameType ? (
        <GameMark id={gameType} size={64} />
      ) : (
        <span className="history-symbol-plain">
          <Icon name="controller" size={24} />
        </span>
      )}
      {humanWon && (
        <span className="history-symbol-badge" aria-hidden="true">
          <Icon name="trophy" size={13} />
        </span>
      )}
    </span>
  );
}
