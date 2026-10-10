import { knownValue } from "@/domain/view-contracts";
import { effectLabel, statLabel, statusLabel } from "./battleLabels";
import { useEffect, useRef } from "react";

const mon = (value = "") => value.replace(/^p[12][a-z]?: /, "");

/** Render public protocol as text; never render protocol HTML or private requests. */
export function logLine(line: string): string | null {
  const [, kind, a, b, c] = line.split("|");

  switch (kind) {
    case "turn":
      return `Turn ${a}`;
    case "move":
      return `${mon(a)} used ${b}.`;
    case "switch":
    case "drag":
      return `${mon(a)} entered the battle.`;
    case "faint":
      return `${mon(a)} fainted.`;
    case "-damage":
      return `${mon(a)} has ${b?.split(" ")[0]} HP left.`;
    case "-heal":
      return `${mon(a)} recovered HP.`;
    case "-status":
      return `${mon(a)} is ${statusLabel(b ?? "").toLowerCase()}.`;
    case "-curestatus":
      return `${mon(a)} recovered from its status condition.`;
    case "-boost":
      return `${mon(a)} gained ${c} ${statLabel(b ?? "")}.`;
    case "-unboost":
      return `${mon(a)} lost ${c} ${statLabel(b ?? "")}.`;
    case "-supereffective":
      return "It was super effective!";
    case "-resisted":
      return "It was not very effective.";
    case "-crit":
      return "A critical hit!";
    case "-miss":
      return `${mon(a)} missed.`;
    case "-immune":
      return `${mon(a)} was unaffected.`;
    case "-fail":
      return "The move failed.";
    case "cant":
      return `${mon(a)} could not move: ${knownValue({ par: "fully paralyzed", slp: "asleep", frz: "frozen", recharge: "must recharge", flinch: "flinched", nopp: "no PP left", trapped: "partially trapped" }, b ?? "") ?? effectLabel(b ?? "unable to act")}.`;
    case "-start":
      return `${mon(a)}: ${effectLabel(b ?? "effect")} started.`;
    case "-end":
      return `${mon(a)}: ${effectLabel(b ?? "effect")} ended.`;
    case "-activate":
      return `${mon(a)}: ${effectLabel(b ?? "effect")}.`;
    case "-mustrecharge":
      return `${mon(a)} must recharge.`;
    case "-hitcount":
      return `Hit ${b} times.`;
    case "-setboost":
      return `${mon(a)}: ${statLabel(b ?? "")} is now ${c} stages.`;
    case "-clearallboost":
      return "All stat changes were reset.";
    case "-clearboost":
      return `${mon(a)}'s stat changes were reset.`;
    case "-cureteam":
      return `${mon(a)}'s team recovered from status conditions.`;
    case "win":
      return `${a} won the battle.`;
    case "tie":
      return "The battle ended in a draw.";
    case "message":
      return a ?? null;
    default:
      return null;
  }
}

export function BattleLog({ lines, offset = 0 }: { lines: string[]; offset?: number }) {
  const scroll = useRef<HTMLDivElement>(null),
    follow = useRef(true);

  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [lines]);

  const entries = lines
    .map((line, index) => {
      const text = logLine(line),
        ident = line.split("|")[2] ?? "",
        name = mon(ident);

      const named = /^p[12][a-z]?: /.test(ident) && Boolean(name) && text?.startsWith(name + " ");

      return {
        id: offset + index,
        text,
        turn: line.startsWith("|turn|"),
        kind: line.split("|")[1]?.replace(/^-/, ""),
        name: named ? name : null,
        seat: ident.slice(0, 2),
      };
    })
    .filter((entry) => entry.text);

  return (
    <aside className="poke-log" aria-label="Battle log">
      <h2>Battle log</h2>
      <div
        ref={scroll}
        className="poke-log-scroll"
        role="region"
        aria-label="Battle history"
        tabIndex={0}
        onScroll={() => {
          const el = scroll.current;

          if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
        }}
      >
        {entries.length ? (
          entries.map((entry) =>
            entry.turn ? (
              <h3 key={entry.id}>
                <span>{entry.text}</span>
              </h3>
            ) : (
              <p key={entry.id} data-kind={entry.kind}>
                {entry.name ? (
                  <>
                    <span className="poke-log-name" data-seat={entry.seat}>
                      {entry.name}
                    </span>
                    {entry.text?.slice(entry.name.length)}
                  </>
                ) : (
                  entry.text
                )}
              </p>
            ),
          )
        ) : (
          <p className="poke-log-empty">Moves and results appear here as the battle unfolds.</p>
        )}
      </div>
    </aside>
  );
}
