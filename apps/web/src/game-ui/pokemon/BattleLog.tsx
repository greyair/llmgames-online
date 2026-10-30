import { knownValue } from "@/domain/view-contracts";
import { effectLabel, statLabel, statusLabel } from "./battleLabels";
import { useEffect, useRef } from "react";
import { useT, type MessageKey, type Translate } from "@/i18n";

const mon = (value = "") => value.replace(/^p[12][a-z]?: /, "");

const cantKeys = {
  par: "board.pokemon.cantParalyzed",
  slp: "board.pokemon.cantAsleep",
  frz: "board.pokemon.cantFrozen",
  recharge: "board.pokemon.cantRecharge",
  flinch: "board.pokemon.cantFlinch",
  nopp: "board.pokemon.cantNoPp",
  trapped: "board.pokemon.cantTrapped",
} satisfies Record<string, MessageKey>;

/** Render public protocol as text; never render protocol HTML or private requests. */
export function logLine(line: string, t: Translate): string | null {
  const [, kind, a, b, c] = line.split("|");
  const name = mon(a);

  switch (kind) {
    case "turn":
      return t("board.pokemon.logTurn", { turn: a ?? "" });
    case "move":
      return t("board.pokemon.logMove", { name, move: b ?? "" });
    case "switch":
    case "drag":
      return t("board.pokemon.logEnter", { name });
    case "faint":
      return t("board.pokemon.logFaint", { name });
    case "-damage":
      return t("board.pokemon.logDamage", { name, hp: b?.split(" ")[0] ?? "" });
    case "-heal":
      return t("board.pokemon.logHeal", { name });
    case "-status":
      return t("board.pokemon.logStatus", {
        name,
        status: statusLabel(b ?? "", t).toLowerCase(),
      });
    case "-curestatus":
      return t("board.pokemon.logCureStatus", { name });
    case "-boost":
      return t("board.pokemon.logBoost", {
        name,
        count: c ?? "",
        stat: statLabel(b ?? "", t),
      });
    case "-unboost":
      return t("board.pokemon.logUnboost", {
        name,
        count: c ?? "",
        stat: statLabel(b ?? "", t),
      });
    case "-supereffective":
      return t("board.pokemon.logSuperEffective");
    case "-resisted":
      return t("board.pokemon.logResisted");
    case "-crit":
      return t("board.pokemon.logCritical");
    case "-miss":
      return t("board.pokemon.logMiss", { name });
    case "-immune":
      return t("board.pokemon.logImmune", { name });
    case "-fail":
      return t("board.pokemon.logFail");
    case "cant": {
      const key = knownValue(cantKeys, b ?? "");
      const reason = key ? t(key) : effectLabel(b ?? "", t) || t("board.pokemon.cantFallback");

      return t("board.pokemon.logCant", { name, reason });
    }

    case "-start":
      return t("board.pokemon.logEffectStart", {
        name,
        effect: effectLabel(b || t("board.pokemon.effectFallback"), t),
      });
    case "-end":
      return t("board.pokemon.logEffectEnd", {
        name,
        effect: effectLabel(b || t("board.pokemon.effectFallback"), t),
      });
    case "-activate":
      return t("board.pokemon.logEffectActive", {
        name,
        effect: effectLabel(b || t("board.pokemon.effectFallback"), t),
      });
    case "-mustrecharge":
      return t("board.pokemon.logRecharge", { name });
    case "-hitcount":
      return t("board.pokemon.logHitCount", { count: b ?? "" });
    case "-setboost":
      return t("board.pokemon.logSetBoost", {
        name,
        stat: statLabel(b ?? "", t),
        count: c ?? "",
      });
    case "-clearallboost":
      return t("board.pokemon.logClearAllBoosts");
    case "-clearboost":
      return t("board.pokemon.logClearBoost", { name });
    case "-cureteam":
      return t("board.pokemon.logCureTeam", { name });
    case "win":
      return t("board.pokemon.logWin", { name: a ?? "" });
    case "tie":
      return t("board.pokemon.logTie");
    case "message":
      return a ?? null;
    default:
      return null;
  }
}

export function BattleLog({ lines, offset = 0 }: { lines: string[]; offset?: number }) {
  const t = useT();

  const scroll = useRef<HTMLDivElement>(null),
    follow = useRef(true);

  useEffect(() => {
    if (follow.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [lines]);

  const entries = lines
    .map((line, index) => {
      const text = logLine(line, t),
        ident = line.split("|")[2] ?? "",
        name = mon(ident);

      const named = /^p[12][a-z]?: /.test(ident) && Boolean(name) && text?.startsWith(name);

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
    <aside className="poke-log" aria-label={t("board.pokemon.battleLog")}>
      <h2>{t("board.pokemon.battleLog")}</h2>
      <div
        ref={scroll}
        className="poke-log-scroll"
        role="region"
        aria-label={t("board.pokemon.battleHistory")}
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
          <p className="poke-log-empty">{t("board.pokemon.logEmpty")}</p>
        )}
      </div>
    </aside>
  );
}
