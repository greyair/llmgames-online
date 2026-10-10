import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import type { AgentGameLogDocument } from "@/services/auth";
import { getGame } from "./catalog";
import { GameMark } from "./GameMark";

export function GameLog({ game, onClose }: { game: AgentGameLogDocument; onClose: () => void }) {
  const [limit, setLimit] = useState(50);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="game-log-dialog">
        <div className="game-log-head">
          <GameMark id={game.gameType} size={44} />
          <div>
            <DialogTitle>{getGame(game.gameType)?.title ?? "Game"} event log</DialogTitle>
            <DialogDescription>
              {game.events.length} server-recorded events. Open an event to inspect its details.
            </DialogDescription>
          </div>
        </div>
        <ol className="game-events">
          {game.events.slice(0, limit).map((event, index) => (
            <li key={`${event.seq}:${index}`}>
              <details>
                <summary>
                  <span>{event.type.replaceAll("_", " ")}</span>
                  <time>
                    {new Date(event.at).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </time>
                </summary>
                <pre tabIndex={0} aria-label={`Event ${event.seq} details`}>
                  {JSON.stringify(event.summary ?? { type: event.type }, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ol>
        {game.events.length === 0 && (
          <p className="game-log-empty">No event details were retained for this match.</p>
        )}
        {limit < game.events.length && (
          <Button variant="outline" size="sm" onClick={() => setLimit((value) => value + 50)}>
            Show more events
          </Button>
        )}
        <DialogFooter>
          <DialogClose className={buttonVariants({ variant: "outline" })}>Close log</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
