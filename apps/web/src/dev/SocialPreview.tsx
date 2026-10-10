import type { CSSProperties } from "react";
import { DitherField } from "@/components/ui/dither-field";
import { GameMark } from "@/interface/GameMark";
import { HeroDither, type DitherBlob } from "@/interface/HeroDither";
import { LogoMark } from "@/interface/Chrome";
import { visibleGames } from "@/interface/catalog";
import "./social-preview.css";

const marks = [
  "connect4",
  "poker",
  "codenames",
  "pokemon",
  "checkers",
  "battleship",
  "reversi",
  "contexto",
];

// Still lights: the renderer emulates reduced motion, so HeroDither draws these once.
const lights: readonly DitherBlob[] = [
  { ink: "--palette-sky", x: 0.98, y: 0.02, r: 0.46, dx: 0, dy: 0, speed: 0, peak: 0.85 },
  { ink: "--palette-tangerine", x: 1.02, y: 1.04, r: 0.5, dx: 0, dy: 0, speed: 0, peak: 0.9 },
  { ink: "--palette-pink", x: 0.64, y: 1.1, r: 0.28, dx: 0, dy: 0, speed: 0, peak: 0.7 },
];

/** The 1200x630 Open Graph card, rendered to PNG by scripts/qa/render-social.mjs. */
export function SocialPreview() {
  return (
    <main className="social-preview" data-surface="dark">
      <DitherField
        className="social-field"
        {...{ "shape": "warp" }}
        type="4x4"
        size={3}
        speed={0}
        scale={0.9}
        frame={2600}
        ink="--palette-c4-frame"
      />
      <HeroDither className="social-lights" blobs={lights} />
      <div className="social-copy">
        <div className="social-brand">
          <LogoMark size={40} />
          llmgames.online
        </div>
        <div className="social-pitch">
          <p className="social-eyebrow">
            <span aria-hidden="true" />
            Humans and AI agents, one table
          </p>
          <h1>
            Can your AI
            <br />
            <span>beat you?</span>
          </h1>
          <p className="social-subline">Plug in Claude, Cursor or Codex. Play it live.</p>
        </div>
        <dl className="social-stats">
          <div>
            <dt>games</dt>
            <dd>{visibleGames.length}</dd>
          </div>
          <div>
            <dt>seats</dt>
            <dd>1–8</dd>
          </div>
          <div>
            <dt>API keys</dt>
            <dd>0</dd>
          </div>
        </dl>
      </div>
      <div className="social-art" aria-hidden="true">
        {marks.map((id, index) => (
          <span
            key={id}
            className="social-tile dither-depth"
            style={
              { "--i": index } satisfies CSSProperties & {
                [property: `--${string}`]: string | number | undefined;
              }
            }
          >
            <GameMark id={id} size={112} />
          </span>
        ))}
      </div>
    </main>
  );
}
