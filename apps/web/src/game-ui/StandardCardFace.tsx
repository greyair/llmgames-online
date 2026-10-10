import { knownValue } from "@/domain/view-contracts";

const pips = {
  A: [[50, 70]],
  "2": [
    [50, 34],
    [50, 106],
  ],
  "3": [
    [50, 34],
    [50, 70],
    [50, 106],
  ],
  "4": [
    [33, 34],
    [67, 34],
    [33, 106],
    [67, 106],
  ],
  "5": [
    [33, 34],
    [67, 34],
    [50, 70],
    [33, 106],
    [67, 106],
  ],
  "6": [
    [33, 34],
    [67, 34],
    [33, 70],
    [67, 70],
    [33, 106],
    [67, 106],
  ],
  "7": [
    [33, 34],
    [67, 34],
    [50, 52],
    [33, 70],
    [67, 70],
    [33, 106],
    [67, 106],
  ],
  "8": [
    [33, 34],
    [67, 34],
    [50, 52],
    [33, 70],
    [67, 70],
    [50, 88],
    [33, 106],
    [67, 106],
  ],
  "9": [
    [33, 32],
    [67, 32],
    [33, 56],
    [67, 56],
    [50, 70],
    [33, 84],
    [67, 84],
    [33, 108],
    [67, 108],
  ],
  "10": [
    [33, 32],
    [67, 32],
    [50, 46],
    [33, 56],
    [67, 56],
    [33, 84],
    [67, 84],
    [50, 94],
    [33, 108],
    [67, 108],
  ],
} satisfies Record<string, number[][]>;

const suitPaths = {
  "♥": "M12 21.4 10.6 20.1C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.6 11.6Z",
  "♦": "M12 1.6C14.5 5.5 17.4 8.9 20.6 12 17.4 15.1 14.5 18.5 12 22.4 9.5 18.5 6.6 15.1 3.4 12 6.6 8.9 9.5 5.5 12 1.6Z",
  "♠": "M12 1.8C9.2 5.6 3 9.4 3 14.1a4.6 4.6 0 0 0 7.7 3.4L9.4 22.2h5.2l-1.3-4.7A4.6 4.6 0 0 0 21 14.1c0-4.7-6.2-8.5-9-12.3Z",
  "♣": "M12 2.4a4.4 4.4 0 0 1 3.6 6.9 4.4 4.4 0 1 1-2.4 7.9l1.4 5H9.4l1.4-5a4.4 4.4 0 1 1-2.4-7.9A4.4 4.4 0 0 1 12 2.4Z",
} satisfies Record<string, string>;

function Suit({
  suit,
  x,
  y,
  size,
  flip = false,
}: {
  suit: string;
  x: number;
  y: number;
  size: number;
  flip?: boolean;
}) {
  return (
    <g transform={flip ? `rotate(180 ${x} ${y})` : undefined}>
      <svg x={x - size / 2} y={y - size / 2} width={size} height={size} viewBox="0 0 24 24">
        <path d={knownValue(suitPaths, suit)} fill="currentColor" />
      </svg>
    </g>
  );
}

/** Simple geometric court art: a crown for kings, a beaded coronet for queens, a chevron for jacks. */
function CourtArt({ rank, suit }: { rank: string; suit: string }) {
  const emblem =
    rank === "K" ? (
      <>
        <path className="court-ink" d="M36 52 38.5 34 45 42 50 30 55 42 61.5 34 64 52Z" />
        <rect className="court-ink" x="36" y="54" width="28" height="2.5" rx="1.25" />
      </>
    ) : rank === "Q" ? (
      <>
        <path className="court-ink" d="M38.5 52 37.5 39 44 45.5 50 37 56 45.5 62.5 39 61.5 52Z" />
        <circle className="court-ink" cx="37.5" cy="36.5" r="2.4" />
        <circle className="court-ink" cx="50" cy="34" r="2.4" />
        <circle className="court-ink" cx="62.5" cy="36.5" r="2.4" />
        <rect className="court-ink" x="38.5" y="54" width="23" height="2.5" rx="1.25" />
      </>
    ) : (
      <>
        <path className="court-ink" d="M37 32 50 44 63 32V40.5L50 52.5 37 40.5Z" />
        <rect className="court-ink" x="40" y="54" width="20" height="2.5" rx="1.25" />
      </>
    );

  return (
    <g className="card-court">
      <rect className="court-panel" x="22" y="22" width="56" height="96" rx="6" />
      <rect className="court-frame" x="25.5" y="25.5" width="49" height="89" rx="4" />
      <path className="court-band" d="M22 70H78" />
      {[false, true].map((flipped) => (
        <g key={String(flipped)} transform={flipped ? "rotate(180 50 70)" : undefined}>
          {emblem}
          <Suit suit={suit} x={50} y={63} size={10} />
        </g>
      ))}
    </g>
  );
}

/** Decorative face only. Rank and visibility still come from the server projection. */
export function StandardCardFace({ rank, suit }: { rank: string; suit: string }) {
  const court = ["J", "Q", "K"].includes(rank);

  const corner = (
    <g className="card-corner">
      <text
        x="12"
        y="27"
        textAnchor="middle"
        fontSize={rank === "10" ? 20 : 27}
        letterSpacing={rank === "10" ? -2 : 0}
      >
        {rank}
      </text>
      <Suit suit={suit} x={12} y={40} size={15} />
    </g>
  );

  return (
    <svg className="standard-card-face" data-rank={rank} viewBox="0 0 100 140" aria-hidden="true">
      <rect className="card-paper" x="0" y="0" width="100" height="140" rx="10" />
      <g transform="translate(1 0)">{corner}</g>
      <g transform="rotate(180 50 70) translate(1 0)">{corner}</g>
      {court ? (
        <CourtArt rank={rank} suit={suit} />
      ) : (
        <g className="card-pips">
          {(knownValue(pips, rank) ?? pips.A!).map(([x, y], i) => (
            <Suit key={i} suit={suit} x={x!} y={y!} size={rank === "A" ? 44 : 19} flip={y! > 70} />
          ))}
        </g>
      )}
    </svg>
  );
}
