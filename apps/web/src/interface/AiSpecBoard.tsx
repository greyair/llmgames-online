import { z } from "zod";
import { cardSchema, monsterSchema } from "@/domain/view-contracts";
import { Fragment } from "react";
import { Discs } from "@/game-ui/Discs";
import { Checkers } from "@/game-ui/Checkers";
import { PlayingCard } from "@/game-ui/Cards";
import { Sprite, MonsterStatus } from "@/game-ui/pokemon/MonsterView";

import { contextoRankStyle } from "@/game-ui/contextoRankStyle";
import "@/game-ui/pokemon/pokemon.css";
import "@/game-ui/contexto.css";

// Both channels render their displayed request state, never a separate board fixture.
const previewStateSchema = z.object({
  board: z.array(z.string()).optional(),
  phase: z.string().optional(),
  yourSeat: z.union([z.string(), z.number()]).optional(),
  cards: z
    .array(z.tuple([z.number(), z.string(), z.boolean(), z.union([z.string(), z.null()])]))
    .optional(),
  clue: z.object({ word: z.string(), count: z.union([z.number(), z.string()]) }).optional(),
  community: z.array(cardSchema).optional(),
  pot: z.number().optional(),
  seats: z.array(z.object({ isYou: z.boolean(), hole: z.array(cardSchema).optional() })).optional(),
  sides: z.array(z.object({ seat: z.string(), pokemon: z.array(monsterSchema) })).optional(),
  ownGrid: z.array(z.string()).optional(),
  targetGrid: z.array(z.string()).optional(),
  munitionPoints: z.number().optional(),
  guesses: z.array(z.object({ word: z.string(), rank: z.number() })).optional(),
  yourProgress: z
    .object({ guesses: z.array(z.object({ word: z.string(), rank: z.number() })) })
    .optional(),
});

const readOnly = () => {};

function SeaGrid({ cells, label }: { cells: (string | null)[][]; label: string }) {
  return (
    <div className="spec-sea">
      <span>{label}</span>
      <div className="sea-grid" role="group" aria-label={label}>
        <span />
        {Array.from({ length: 10 }, (_, col) => (
          <span className="sea-coordinate" key={col}>
            {col}
          </span>
        ))}
        {cells.map((row, r) => (
          <Fragment key={r}>
            <span className="sea-coordinate">{r}</span>
            {row.map((cell, c) => (
              <span
                key={c}
                className="sea-cell"
                data-ship={cell === "s"}
                data-mine={cell === "m"}
                data-hit={cell === "x"}
                data-miss={cell === "o"}
                role="img"
                aria-label={`Row ${r}, column ${c}, ${cell === "x" ? "hit" : cell === "o" ? "miss" : cell === "s" ? "your ship" : cell === "m" ? "your armed mine" : cell === "." ? (label.startsWith("Target") ? "unknown" : "water") : (cell ?? "water")}`}
              >
                {cell === "x" ? "×" : cell === "o" ? "·" : cell === "m" ? "M" : ""}
              </span>
            ))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export function AiSpecBoard<T>({ gameId, value }: { gameId: string; value: T }) {
  const state = previewStateSchema.parse(value ?? {});
  const numericBoard = state.board?.map((row) => [...row].map(Number));
  const guesses = state.guesses ?? state.yourProgress?.guesses ?? [];

  return (
    <figure
      className="spec-board"
      aria-label="Example seat view"
      data-game={gameId}
      data-surface="dark"
    >
      {(gameId === "connect4" || gameId === "reversi") && (
        <Discs
          state={{ type: gameId, status: "playing", replayReadOnly: true, board: numericBoard }}
          send={readOnly}
        />
      )}
      {gameId === "checkers" && (
        <Checkers
          state={{ type: gameId, status: "playing", replayReadOnly: true, board: numericBoard }}
          send={readOnly}
        />
      )}
      {gameId === "codenames" && (
        <div className="spec-words">
          <span>
            Clue: {state.clue?.word} · {state.clue?.count}
          </span>
          <div className="words-board" aria-label="Codenames board">
            {state.cards?.map(([index, word, revealed, team]) => (
              <div
                key={index}
                className="word-card"
                data-team={team ?? "hidden"}
                data-revealed={revealed}
              >
                <span>{word}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {gameId === "poker" && (
        <div className="spec-poker">
          <div>
            <span>Community · Pot {state.pot}</span>
            <div className="spec-card-row">
              {state.community?.map((card, index) => (
                <PlayingCard key={index} card={card} />
              ))}
            </div>
          </div>
          <div>
            <span>Your hand</span>
            <div className="spec-card-row">
              {state.seats
                ?.find((seat) => seat.isYou)
                ?.hole?.map((card, index) => (
                  <PlayingCard key={index} card={card} />
                ))}
            </div>
          </div>
          <div>
            <span>Opponent</span>
            <div className="spec-card-row">
              {[0, 1].map((index) => (
                <PlayingCard key={index} card={{ rank: "?", suit: "", hidden: true }} />
              ))}
            </div>
          </div>
        </div>
      )}
      {gameId === "pokemon" && (
        <div className="spec-pokemon">
          {state.sides?.map((side) => {
            const mon = side.pokemon.find((mon) => mon.active) ?? side.pokemon[0];

            return (
              mon && (
                <div key={side.seat}>
                  <span>{side.seat === state.yourSeat ? "Your Pokémon" : "Opponent"}</span>
                  <Sprite mon={mon} />
                  <MonsterStatus mon={mon} />
                </div>
              )
            );
          })}
        </div>
      )}
      {gameId === "battleship" && (
        <div className="spec-fleets">
          <SeaGrid
            cells={
              state.ownGrid?.map((row) => [...row]) ??
              Array.from({ length: 10 }, () => Array<string | null>(10).fill(null))
            }
            label={
              state.phase === "placement"
                ? "Your fleet · Not placed"
                : `Your fleet · ${state.munitionPoints ?? 0} energy`
            }
          />
          {state.targetGrid && (
            <SeaGrid
              cells={state.targetGrid.map((row) => [...row])}
              label="Target · Unrevealed fleet"
            />
          )}
        </div>
      )}
      {gameId === "contexto" && (
        <div className="spec-contexto contexto-stage">
          <span>Your guesses · Lower rank is closer</span>
          <ol className="contexto-own-list">
            {guesses.map((guess) => (
              <li
                className="contexto-rank-row"
                key={guess.word}
                style={contextoRankStyle(guess.rank)}
              >
                <strong>{guess.word}</strong>
                <b>{guess.rank}</b>
              </li>
            ))}
          </ol>
          {!guesses.length && <p>No guesses yet</p>}
        </div>
      )}
      <figcaption>Example seat view · Matches the request below</figcaption>
    </figure>
  );
}
