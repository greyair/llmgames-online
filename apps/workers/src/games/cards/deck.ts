/**
 * Playing cards shared by 跑得快 (PaoDeKuai) and 斗地主 (DouDiZhu), ported from
 * West Window's `paodekuai-cards.ts` and `doudizhu-cards.ts` (MIT, SerenQi).
 *
 * A card is the text `"S3"`, `"HT"`, `"DJ"` — suit letter then rank — and the
 * two jokers are `"j1"` (small) and `"j2"` (big). Text keeps the state, the
 * archive and the agent view readable without a decoder ring, and the deck is
 * small enough that the readability is worth more than the bytes.
 *
 * Rank strength is one ladder for both games: 3 … 2 is 0 … 12, then the two
 * jokers. Only 斗地主 deals the jokers, so 跑得快 simply never sees 13 or 14.
 */

/** A card id: `S3`, `HT`, `DJ`, `j1` or `j2`. */
export type Card = string;

export const RANK_LETTERS = [
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "T",
  "J",
  "Q",
  "K",
  "A",
  "2",
] as const;

export const SUITS = ["S", "H", "C", "D"] as const;

export const SMALL_JOKER = "j1";

export const BIG_JOKER = "j2";

/** Strength of a rank, 0 (3) to 14 (big joker). */
export const RANK_LOW = 0;

export const RANK_TWO = 12;

export const RANK_SMALL_JOKER = 13;

export const RANK_BIG_JOKER = 14;

const SUIT_ORDER = new Map<string, number>([
  ["S", 0],
  ["H", 1],
  ["C", 2],
  ["D", 3],
]);

const RANK_INDEX = new Map<string, number>(
  RANK_LETTERS.map((letter, index) => [letter, index] as const),
);

/** Strength of a card, 0 (3) to 14 (big joker). */
export function cardRank(card: string): number {
  if (card === SMALL_JOKER) return RANK_SMALL_JOKER;

  if (card === BIG_JOKER) return RANK_BIG_JOKER;

  return RANK_INDEX.get(card.slice(1)) ?? RANK_LOW;
}

export function isJoker(card: string): boolean {
  return card === SMALL_JOKER || card === BIG_JOKER;
}

/** Human label: `♠3`, `♥10`, `J1`, `J2`. Jokers never use a suit letter, so
 *  `J1` cannot be confused with the jack of spades (`SJ`). */
export function cardText(card: string): string {
  if (card === SMALL_JOKER) return "J1";

  if (card === BIG_JOKER) return "J2";

  const suit = card.slice(0, 1);
  const rank = card.slice(1);
  const glyph = suit === "S" ? "♠" : suit === "H" ? "♥" : suit === "C" ? "♣" : "♦";

  return `${glyph}${rank === "T" ? "10" : rank}`;
}

export function cardsText(cards: readonly string[]): string {
  return cards.map(cardText).join(" ");
}

/** Rank name for messages: `3` … `A`, `2`, `J1`, `J2`. */
export function rankText(rank: number): string {
  if (rank === RANK_SMALL_JOKER) return "J1";

  if (rank === RANK_BIG_JOKER) return "J2";

  const letter = RANK_LETTERS[rank] ?? "3";

  return letter === "T" ? "10" : letter;
}

/** Weakest first, suits in spade-heart-club-diamond order inside a rank. */
export function sortCards(cards: readonly string[]): string[] {
  return [...cards].sort(
    (a, b) => cardRank(a) - cardRank(b) || suitIndex(a) - suitIndex(b),
  );
}

function suitIndex(card: string): number {
  return SUIT_ORDER.get(card.slice(0, 1)) ?? 9;
}

/** Group card strengths for shape detection. */
export function rankCounts(cards: readonly string[]): Map<number, number> {
  const counts = new Map<number, number>();

  for (const card of cards)
    counts.set(cardRank(card), (counts.get(cardRank(card)) ?? 0) + 1);

  return counts;
}

/** Cards of one strength, weakest suit first, for picking a concrete play. */
export function cardsOfRank(hand: readonly string[], rank: number, count: number): string[] {
  return sortCards(hand)
    .filter((card) => cardRank(card) === rank)
    .slice(0, count);
}

/** The 48-card 跑得快 deck: no jokers, no ♥2 ♣2 ♦2, no ♠A. */
export function paodekuaiDeck(): string[] {
  const deck: string[] = [];

  for (const suit of SUITS)
    for (const rank of RANK_LETTERS) {
      const card = `${suit}${rank}`;

      if (card === "H2" || card === "C2" || card === "D2" || card === "SA") continue;

      deck.push(card);
    }

  return deck;
}

/** The full 54-card 斗地主 deck, jokers included. */
export function doudizhuDeck(): string[] {
  const deck: string[] = [];

  for (const suit of SUITS) for (const rank of RANK_LETTERS) deck.push(`${suit}${rank}`);

  deck.push(SMALL_JOKER, BIG_JOKER);

  return deck;
}

/**
 * Resolve player-typed cards against a hand.
 *
 * Accepts the exact cards (`"S3 H3"`) or ranks only (`"3 3"`, `"10 J Q K A"`),
 * picking the weakest suits for a rank. Returns the resolved cards or the
 * sentence that refuses them — the same union the rest of the games use.
 */
export function pickCards(hand: readonly string[], text: string): string[] | string {
  const tokens = text
    .toUpperCase()
    .replaceAll("10", "T")
    .replaceAll("♠", "S")
    .replaceAll("♥", "H")
    .replaceAll("♣", "C")
    .replaceAll("♦", "D")
    .split(/[\s,]+/)
    .filter(Boolean);

  if (tokens.length === 0) return "Play at least one card";

  const byRank = new Map<number, string[]>();

  for (const card of sortCards(hand)) {
    const rank = cardRank(card);
    const bucket = byRank.get(rank);

    if (bucket) bucket.push(card);
    else byRank.set(rank, [card]);
  }

  const picked: string[] = [];
  const wanted = new Map<number, number>();

  for (const token of tokens) {
    const rank = tokenToRank(token);

    if (rank === null) return `Not a card: ${token}`;

    wanted.set(rank, (wanted.get(rank) ?? 0) + 1);
  }

  for (const [rank, count] of wanted) {
    const available = byRank.get(rank) ?? [];

    if (available.length < count)
      return `You only hold ${available.length} × ${rankText(rank)}`;

    picked.push(...available.slice(0, count));
  }

  return sortCards(picked);
}

/** `S3` names one card, `3` names a rank, `T`/`10` both mean ten. */
function tokenToRank(token: string): number | null {
  const lower = token.toLowerCase();

  if (lower === "j1") return RANK_SMALL_JOKER;

  if (lower === "j2") return RANK_BIG_JOKER;

  const head = token.slice(0, 1);

  if (SUIT_ORDER.has(head) && token.length > 1) {
    const rank = RANK_INDEX.get(token.slice(1));

    return rank ?? null;
  }

  return RANK_INDEX.get(token) ?? null;
}
