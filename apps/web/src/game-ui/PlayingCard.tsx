/**
 * One card face, shared by the two card games.
 *
 * Card ids are `<suit><rank>` — `S3`, `HT`, `DJ` — plus `j1` / `j2` for the
 * jokers. The label is derived here rather than in each board so the two games
 * can never disagree about what a card looks like.
 */

const JOKER_SMALL = "j1";

const JOKER_BIG = "j2";

export function isRedCard(card: string): boolean {
  return card.startsWith("H") || card.startsWith("D");
}

export function isJokerCard(card: string): boolean {
  return card === JOKER_SMALL || card === JOKER_BIG;
}

export function cardRankLabel(card: string): string {
  if (card === JOKER_SMALL) return "J1";

  if (card === JOKER_BIG) return "J2";

  const rank = card.slice(1);

  return rank === "T" ? "10" : rank;
}

export function cardSuitLabel(card: string): string {
  if (isJokerCard(card)) return "★";

  const suit = card.slice(0, 1);

  if (suit === "S") return "♠";

  if (suit === "H") return "♥";

  return suit === "C" ? "♣" : "♦";
}

export function PlayingCard({
  card,
  selected = false,
  small = false,
  onToggle,
}: {
  card: string;
  selected?: boolean;
  small?: boolean;
  onToggle?: () => void;
}) {
  const rank = cardRankLabel(card);

  return (
    <button
      type="button"
      className={`ct-card ${small ? "ct-card-sm" : ""}`.trim()}
      data-red={isRedCard(card) ? "true" : "false"}
      data-selected={selected ? "true" : "false"}
      data-joker={isJokerCard(card) ? "true" : "false"}
      disabled={!onToggle}
      aria-pressed={onToggle ? selected : undefined}
      aria-label={`${rank}${cardSuitLabel(card)}`}
      onClick={onToggle}
    >
      <span className="ct-card-rank">{rank}</span>
      <span className="ct-card-suit">{cardSuitLabel(card)}</span>
    </button>
  );
}
