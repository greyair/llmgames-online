import { wordBoardSchema, cardSeatsSchema } from "@/domain/view-contracts";

import type { ReactNode } from "react";
import type { ClientView } from "@/domain/game-state";
import { playerPrimaryName } from "@/features/shared/playerIdentity";
import { Discs } from "./Discs";
import { Checkers } from "./Checkers";
import { Battleship } from "./Battleship";
import { contextoRankStyle } from "./contextoRankStyle";
import "./final-state.css";

type Point = { row: number; col: number; weapon?: string };

type Ship = Point & {
  id: string;
  rotation?: number;
  "shape"?: { dr: number; dc: number }[];
  cells?: Point[];
  sunk?: boolean;
};

type RadarScan = Point & { shipCells: number; cellsScanned?: number };

type TorpedoPath = Point & { endRow: number; endCol: number; direction?: string };

type Sea = {
  playerId?: string;
  cells?: (string | null)[][];
  ships?: Ship[];
  revealedShips?: Ship[];
  sunkShips?: Ship[];
  hits?: Point[];
  misses?: Point[];
  incomingHits?: Point[];
  incomingMisses?: Point[];
  shipsRemaining?: number;
  radarScans?: RadarScan[];
  bombedAreas?: Point[];
  torpedoPaths?: TorpedoPath[];
  mines?: Point[];
  revealedMines?: Point[];
  triggeredMines?: Point[];
  mineShots?: Point[];
};

const pointKey = ({ row, col }: Point) => `${row}:${col}`;

const playerName = (state: ClientView, id?: string, fallback = "Player") =>
  playerPrimaryName(
    state.players?.find((player) => player.id === id) ?? { id: id ?? fallback, name: fallback },
    fallback,
  );

function positionedCells(sea: Sea) {
  const positions = new Map<string, string>();
  sea.cells?.forEach((line, row) =>
    line.forEach((ship, col) => {
      if (ship) positions.set(`${row}:${col}`, ship);
    }),
  );
  const ships = sea.revealedShips ?? sea.ships ?? sea.sunkShips ?? [];

  for (const ship of ships) {
    const cells =
      ship.cells ??
      ship.shape?.map(({ dr: row, dc: col }) => {
        const rotation = ship.rotation ?? 0;
        const dr = rotation === 90 ? col : rotation === 180 ? -row : rotation === 270 ? -col : row;
        const dc = rotation === 90 ? -row : rotation === 180 ? -col : rotation === 270 ? row : col;

        return { row: ship.row + dr, col: ship.col + dc };
      }) ??
      [];

    for (const cell of cells)
      if (cell.row >= 0 && cell.row < 10 && cell.col >= 0 && cell.col < 10)
        positions.set(pointKey(cell), ship.id);
  }

  return positions;
}

function FinalShips({
  state,
  renderPlayer,
}: {
  state: ClientView;
  renderPlayer?: (playerId?: string) => ReactNode;
}) {
  const own = state.yourBoard ?? null,
    opponent = state.opponent ?? null;

  const perspective = state.replayPerspectivePlayerId ?? state.you?.playerId;

  const source =
    own && opponent ? [{ ...own, playerId: perspective }, opponent] : (state.spectatorBoards ?? []);

  if (!source.length) return null;

  const boards = source.map((sea) => {
    const positions = positionedCells(sea);

    return {
      ...sea,
      ships: (sea.revealedShips ?? sea.ships ?? sea.sunkShips ?? []).map((ship) => ({
        ...ship,
        rotation: ship.rotation ?? 0,
      })),
      mines: sea.revealedMines ?? sea.mines ?? [],
      cells: Array.from({ length: 10 }, (_, row) =>
        Array.from({ length: 10 }, (_, col) => positions.get(`${row}:${col}`) ?? null),
      ),
    };
  });

  return (
    <section className="result-final result-ships" aria-label="Final state">
      <Battleship
        state={{ ...state, spectatorBoards: boards, replayReadOnly: true }}
        finalResult
        renderResultPlayer={renderPlayer}
        send={() => {}}
      />
    </section>
  );
}

function FinalWords({ state }: { state: ClientView }) {
  const progress = state.progress ?? {};

  return (
    <section className="result-final result-final-words" aria-label="Final state">
      {state.secret && (
        <div className="result-word-target">
          <span>Final word</span>
          <strong>{state.secret}</strong>
        </div>
      )}
      <div className="result-guess-grid">
        {state.players?.map((player) => {
          const entry = progress[player.id];

          const best = [...(entry?.guesses ?? [])]
            .filter((guess) => Number.isFinite(guess.rank))
            .sort(
              (a, b) =>
                a.rank - b.rank ||
                ("sequence" in b ? b.sequence : 0) - ("sequence" in a ? a.sequence : 0),
            )
            .slice(0, 5);

          return (
            <article className="result-guess-player" key={player.id}>
              <h3>{playerPrimaryName(player)}</h3>
              <ol>
                {Array.from({ length: 5 }, (_, index) => {
                  const guess = best[index];

                  return guess && "word" in guess ? (
                    <li
                      key={`${guess.sequence ?? index}:${guess.rank}`}
                      style={contextoRankStyle(guess.rank)}
                    >
                      <span>{guess.word}</span>
                      <strong>{guess.rank.toLocaleString()}</strong>
                    </li>
                  ) : (
                    <li
                      className="result-guess-placeholder"
                      key={`placeholder-${index}`}
                      aria-label={guess ? "Word hidden" : "No guess recorded"}
                    >
                      <span aria-hidden="true" />
                      <span aria-hidden="true" />
                    </li>
                  );
                })}
              </ol>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function FinalCodenames({ state }: { state: ClientView }) {
  const board = wordBoardSchema.safeParse(state.board).data ?? [];

  if (!board.length) return null;

  return (
    <section className="result-final" aria-label="Final state">
      <header>
        <h2>Final key</h2>
        <p>
          {board.every((card) => card.affiliation)
            ? "The complete key is visible. Guessed cards are marked."
            : "Guessed cards are marked. Hidden affiliations remain concealed."}
        </p>
      </header>
      <div className="result-word-grid" role="group" aria-label="Final Codenames board">
        {board.map((card) => (
          <div
            key={card.index}
            className="result-word-card"
            data-team={card.affiliation ?? "hidden"}
            data-revealed={Boolean(card.revealed)}
            role="img"
            aria-label={`${card.word}, ${card.affiliation ?? "unknown"}${card.revealed ? ", revealed" : ""}`}
          >
            <span>{card.word}</span>
            {card.revealed && <small>Revealed</small>}
          </div>
        ))}
      </div>
    </section>
  );
}

function FinalPoker({
  state,
  renderPlayer,
}: {
  state: ClientView;
  renderPlayer?: (id?: string) => ReactNode;
}) {
  const seats = [...(cardSeatsSchema.safeParse(state.seats).data ?? [])].sort((a, b) => {
    if (a.playerId === state.winner) return -1;

    if (b.playerId === state.winner) return 1;

    return (b.stack ?? 0) - (a.stack ?? 0);
  });

  return (
    <section className="result-final result-poker" aria-label="Final state">
      <header>
        <h2>Final chips</h2>
      </header>
      <div className="result-poker-standings">
        {seats.map((seat) => {
          return (
            <article className="result-poker-standing" key={seat.playerId}>
              {renderPlayer?.(seat.playerId) ?? (
                <h3>{playerName(state, seat.playerId, "Player")}</h3>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function FinalState({
  state,
  reveal,
  renderShipPlayer,
  renderCardPlayer,
}: {
  state: ClientView;
  reveal?: ClientView | null;
  renderShipPlayer?: (playerId?: string) => ReactNode;
  renderCardPlayer?: (playerId?: string) => ReactNode;
}) {
  const fullReveal = Boolean(reveal?.status === "ended" && reveal.type === state.type);

  const final: ClientView = fullReveal
    ? {
        ...state,
        ...reveal,
        players: state.players ?? reveal?.players,
        you: state.you,
        type: state.type,
        replayReadOnly: true,
      }
    : { ...state, replayReadOnly: true };

  if (["connect4", "reversi", "checkers"].includes(state.type ?? "") && Array.isArray(final.board))
    return (
      <section className="result-board" aria-label="Final board">
        {state.type === "checkers" ? (
          <Checkers state={final} send={() => {}} />
        ) : (
          <Discs state={final} send={() => {}} />
        )}
      </section>
    );

  if (state.type === "battleship")
    return <FinalShips state={final} renderPlayer={renderShipPlayer} />;

  if (state.type === "contexto") return <FinalWords state={final} />;

  if (state.type === "codenames") return <FinalCodenames state={final} />;

  if (state.type === "poker") return <FinalPoker state={final} renderPlayer={renderCardPlayer} />;

  return null;
}
