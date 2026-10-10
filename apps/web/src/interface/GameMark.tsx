import { knownValue } from "@/domain/view-contracts";
import type { CSSProperties } from "react";

/* Each mark is a 10x10 pixel glyph in up to three native inks, drawn on the
   game's squircle. Rows use: # = --game-ink, a = first accent, b = second accent. */
const glyphs = {
  connect4: {
    rows: [
      "..........",
      ".aa.bb.##.",
      ".aa.bb.##.",
      "..........",
      ".bb.aa.bb.",
      ".bb.aa.bb.",
      "..........",
      ".aa.bb.aa.",
      ".aa.bb.aa.",
      "..........",
    ],
    a: "var(--palette-c4-red)",
    b: "var(--palette-c4-yellow)",
  },
  checkers: {
    rows: [
      "..........",
      "...a..a...",
      "..aaaaaa..",
      "..........",
      "..######..",
      ".########.",
      ".########.",
      "..######..",
      "..........",
      "..........",
    ],
    a: "var(--palette-crown)",
  },
  reversi: {
    rows: [
      "..........",
      "...####...",
      "..##aa##..",
      ".##aaaa##.",
      ".##aaaa##.",
      ".##aaaa##.",
      ".##aaaa##.",
      "..##aa##..",
      "...####...",
      "..........",
    ],
    a: "var(--palette-disc-black)",
  },
  pokemon: {
    rows: [
      "..........",
      "...aaaa...",
      "..aaaaaa..",
      ".aaaaaaaa.",
      ".bbb##bbb.",
      ".bbb##bbb.",
      ".########.",
      "..######..",
      "...####...",
      "..........",
    ],
    a: "var(--palette-tomato-deep)",
    b: "var(--palette-ink)",
  },
  codenames: {
    rows: [
      "..........",
      ".###..aaa.",
      ".###..aaa.",
      ".###..aaa.",
      "..........",
      ".bbb..###.",
      ".bbb..###.",
      ".bbb..###.",
      "..........",
      "..........",
    ],
    a: "var(--palette-cn-blue)",
    b: "var(--palette-cn-card)",
  },
  poker: {
    rows: [
      ".######...",
      ".#a##a#...",
      ".#aaaa#...",
      ".#aaaa#.bb",
      ".##aa##.bb",
      ".###a##...",
      ".######.bb",
      ".######.bb",
      "..........",
      "..........",
    ],
    a: "var(--palette-card-red)",
    b: "var(--palette-sun)",
  },
  battleship: {
    rows: [
      "..........",
      ".....aa...",
      ".....aa...",
      "..........",
      "...###....",
      ".########.",
      "..######..",
      "...####...",
      ".bb....bb.",
      "..........",
    ],
    a: "var(--palette-peg-red)",
    b: "var(--palette-sea-foam)",
  },
  contexto: {
    rows: [
      "..........",
      ".########.",
      ".########.",
      "..........",
      ".aaaaaa...",
      ".aaaaaa...",
      "..........",
      ".bbb......",
      ".bbb......",
      "..........",
    ],
    a: "var(--palette-rank-warm)",
    b: "var(--palette-rank-cold)",
  },
} satisfies Record<string, { rows: string[]; a?: string; b?: string }>;

function cells(rows: string[], key: string) {
  let path = "";
  rows.forEach((row, y) =>
    [...row].forEach((cell, x) => {
      if (cell === key) path += `M${x} ${y}h1v1h-1z`;
    }),
  );

  return path;
}

/** A game's identity tile: a pixel glyph in native inks on the game's squircle. */
export function GameMark({
  id,
  size = 40,
  className,
}: {
  id: string;
  size?: number;
  className?: string;
}) {
  const mark = knownValue(glyphs, id);

  return (
    <span
      className={["game-mark", className].filter(Boolean).join(" ")}
      data-game={id}
      aria-hidden="true"
      style={
        { "--mark-size": `${size}px` } satisfies CSSProperties & {
          [property: `--${string}`]: string | number | undefined;
        }
      }
    >
      <svg viewBox="0 0 10 10">
        {mark ? (
          <>
            <path d={cells(mark.rows, "#")} fill="currentColor" />
            {mark.a && <path d={cells(mark.rows, "a")} style={{ fill: mark.a }} />}
            {"b" in mark && mark.b && <path d={cells(mark.rows, "b")} style={{ fill: mark.b }} />}
          </>
        ) : (
          <path d="M3 3h4v4H3z" fill="currentColor" />
        )}
      </svg>
    </span>
  );
}
