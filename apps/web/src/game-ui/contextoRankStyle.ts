import type { CSSProperties } from "react";

export type ContextoHeat = "found" | "scorching" | "hot" | "warm" | "cool" | "cold";

/** Six heat bands share the four native rank inks: green is close, red is far. */
export const CONTEXTO_HEAT_INK: Record<ContextoHeat, string> = {
  found: "rank-hot",
  scorching: "rank-hot",
  hot: "rank-hot",
  warm: "rank-warm",
  cool: "rank-cool",
  cold: "rank-cold",
};

export function contextoHeat(rank: number): ContextoHeat {
  return rank <= 1
    ? "found"
    : rank <= 25
      ? "scorching"
      : rank <= 100
        ? "hot"
        : rank <= 500
          ? "warm"
          : rank <= 1500
            ? "cool"
            : "cold";
}

/** Bar width shrinks on a log scale so rank 1 fills the row and rank 10,000+ is a sliver. */
export function contextoRankStyle(rank: number): CSSProperties {
  const heat = contextoHeat(rank);
  const width = Math.max(4, 100 * (1 - Math.log10(Math.max(1, rank)) / 4.4));
  const color = `var(--palette-${CONTEXTO_HEAT_INK[heat]})`;

  return {
    "--rank-fill": color,
    "--rank-heat": color,
    "--rank-width": `${width}%`,
  } satisfies CSSProperties & { [property: `--${string}`]: string | number | undefined };
}
