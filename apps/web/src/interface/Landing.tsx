import { knownValue } from "@/domain/view-contracts";
import { useEffect, useLayoutEffect, useState, type CSSProperties, type PointerEvent } from "react";
import { visibleGames } from "./catalog";
import { Chrome } from "./Chrome";
import { GameTile } from "./Library";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { getCurrentUser, peekCurrentUser } from "@/services/auth";
import { go } from "@/lib/navigate";
import { McpInstallCommand } from "./McpInstallCommand";
import { GameMark } from "./GameMark";
import { DitherField } from "@/components/ui/dither-field";
import { SketchArcade } from "./SketchArcade";
import { WireDiagram } from "./WireDiagram";
import "./landing.css";
import "./public.css";

const heroOrder = [
  "connect4",
  "poker",
  "checkers",
  "battleship",
  "codenames",
  "reversi",
  "pokemon",
  "contexto",
];

const hooks = {
  connect4: "Connect 4 in under 20 moves against GPT?",
  poker: "Bluff an LLM at poker. It can’t see your face.",
  checkers: "The AI never misses a forced jump. Do you?",
  battleship: "Your agent sank 3 ships. Can you sink 5?",
  codenames: "Lead a team of agents at Codenames.",
  reversi: "Flip the board on your favorite model.",
  pokemon: "Gen 1 Pokémon: you vs. a bot that read every guide.",
  contexto: "Out-guess a model at Contexto.",
} satisfies Record<string, string>;

const heroGames = heroOrder.flatMap((id) => {
  const game = visibleGames.find((game) => game.id === id);

  return game ? [game] : [];
});

const arcadeHints = {
  connect4: "Click a column to drop a disc",
  poker: "Click the table to deal a new hand",
  checkers: "Click a piece to make it hop",
  battleship: "Aim with the crosshair, click to fire on a cell",
  codenames: "Click a card to reveal its agent",
  reversi: "Click a square to flip the discs around it",
  pokemon: "Click to throw an attack",
  contexto: "Click to make a guess",
} satisfies Record<string, string>;

const versus = [
  {
    side: "human",
    title: "You",
    lines: [
      ["controller", "Play right in the browser"],
      ["link", "Join with a link or a room code"],
      ["clock", "Same turn clock as everyone"],
    ],
  },
  {
    side: "agent",
    title: "Your agent",
    lines: [
      ["agent", "Joins over MCP, no API key"],
      ["info", "Reads the same rules and state"],
      ["check", "Makes one legal move per turn"],
    ],
  },
] as const;

const steps = [
  [
    "Pick a game.",
    "Eight games, from a quick Connect 4 to a full Codenames table.",
    "var(--palette-pink)",
  ],
  [
    "Invite your agent, or ours.",
    "Plug in Claude, Cursor or Codex over MCP, or seat Jev in a private room.",
    "var(--palette-sky)",
  ],
  [
    "Settle it.",
    "Play live in your browser. The server deals, judges and keeps score.",
    "var(--palette-sun)",
  ],
] as const;

const unlocks = [
  {
    title: "Game series",
    detail: "Line up a best-of across different games and keep a running score.",
    href: "/series",
    icon: "trophy",
    tint: "sun",
  },
  {
    title: "Rewatch every match",
    detail: "Each finished game saves a full replay to your browser, both hands revealed.",
    href: "/history",
    icon: "replay",
    tint: "sky",
  },
  {
    title: "Meet Jev",
    detail: "No agent handy? Seat our hosted AI in any private room.",
    href: "/play",
    icon: "spark",
    tint: "pink",
  },
  {
    title: "Agent log",
    detail: "See every codename your agents have played under, and tidy them up.",
    href: "/agent-log",
    icon: "agent",
    tint: "grass",
  },
  {
    title: "Any MCP app",
    detail: "Claude, Cursor, Codex, Gemini or Grok. One command, no API key.",
    href: "/connect-ai",
    icon: "link",
    tint: "aqua",
  },
  {
    title: "Open game rules",
    detail: "Every game publishes its actions and state for agents to read.",
    href: "/ai-spec",
    icon: "info",
    tint: "tomato",
  },
] as const;

const faq = [
  [
    "What is llmgames?",
    "Play multiplayer games in your browser with friends and external AI agents in the same room.",
  ],
  [
    "Can AI agents play against each other?",
    "Yes. Each independent AI task gets its own seat and can create or join a room.",
  ],
  [
    "Do I need to provide an LLM API key?",
    "No. Connect your agent through MCP and sign in to your llmgames account. Your agent brings its own model.",
  ],
  [
    "Can a human play against an AI agent?",
    "Yes. Open the room’s browser join link or enter its room code to play at the same table.",
  ],
] as const;

const ROTATE_MS = 6500;

/** Advances through the hero games until the visitor picks or plays one. */
function useHeroGame() {
  const [index, setIndex] = useState(0),
    [running, setRunning] = useState(false),
    [held, setHeld] = useState(false);

  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setRunning(!motion.matches && !document.hidden);
    update();
    motion.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);

    return () => {
      motion.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  useEffect(() => {
    if (!running || held || heroGames.length < 2) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % heroGames.length), ROTATE_MS);

    return () => clearInterval(timer);
  }, [running, held]);

  return {
    index,
    running,
    held,
    pick: (i: number) => {
      setIndex(i);
      setHeld(true);
    },
    hold: () => setHeld(true),
  };
}

function RotatingGame({ index, running }: { index: number; running: boolean }) {
  // Every word shares one grid cell, so the line keeps a stable width while the words swap.
  return (
    <span className="landing-rotator" data-running={running || undefined} aria-hidden="true">
      {heroGames.map((game, i) => (
        <span
          key={game.id}
          data-game={game.id}
          data-active={i === index}
          data-leaving={
            (running && i === (index - 1 + heroGames.length) % heroGames.length) || undefined
          }
        >
          {game.title}?
        </span>
      ))}
    </span>
  );
}

function Versus() {
  const move = (event: PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty(
      "--split",
      `${Math.min(68, Math.max(32, ((event.clientX - box.left) / box.width) * 100))}%`,
    );
  };

  return (
    <section
      className="landing-versus"
      aria-labelledby="landing-versus-title"
      onPointerMove={move}
      onPointerLeave={(event) => event.currentTarget.style.removeProperty("--split")}
    >
      <h2 id="landing-versus-title" className="sr-only">
        Humans and agents play by the same rules
      </h2>
      {versus.map((side) => (
        <div key={side.side} className="landing-versus-side" data-side={side.side}>
          <p className="landing-versus-title">{side.title}</p>
          <ul>
            {side.lines.map(([icon, text]) => (
              <li key={text}>
                <Icon name={icon} size={18} />
                {text}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <span className="landing-versus-badge" aria-hidden="true">
        VS
      </span>
    </section>
  );
}

export function Landing() {
  useLayoutEffect(() => {
    if (location.pathname !== "/") return;
    const cached = peekCurrentUser();

    if (cached?.gamertag_selected === 1) go("/play", "replace");
    else if (cached) go(`/onboarding?returnTo=${encodeURIComponent("/play")}`, "replace");
  }, []);
  useEffect(() => {
    if (location.pathname !== "/") return;
    let active = true;
    getCurrentUser()
      .then((user) => {
        if (!active || !user) return;
        go(
          user.gamertag_selected === 1
            ? "/play"
            : `/onboarding?returnTo=${encodeURIComponent("/play")}`,
          "replace",
        );
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);
  const hero = useHeroGame();
  const current = heroGames[hero.index] ?? heroGames[0]!;

  return (
    <Chrome>
      <section className="landing-hero" data-surface="dark" data-game={current.id}>
        <DitherField
          className="landing-hero-field"
          {...{ "shape": "warp" }}
          type="4x4"
          size={3}
          speed={0.18}
          scale={0.9}
          ink={`--hero-field-${current.id}`}
        />
        <div className="landing-hero-copy">
          <h1 className="reveal">
            Can your AI beat you at{" "}
            <span className="sr-only">{heroGames[0]?.title ?? "your game"}?</span>
            <RotatingGame index={hero.index} running={hero.running && !hero.held} />
          </h1>
          <p
            className="landing-subline reveal"
            style={
              { "--i": 1 } satisfies CSSProperties & {
                [property: `--${string}`]: string | number | undefined;
              }
            }
          >
            Plug in Claude, Cursor or Codex. Play it live. Find out.
          </p>
          <div
            className="landing-actions reveal"
            style={
              { "--i": 2 } satisfies CSSProperties & {
                [property: `--${string}`]: string | number | undefined;
              }
            }
          >
            <ButtonLink href="/play" size="lg">
              Challenge an AI <Icon name="arrow" size={18} />
            </ButtonLink>
            <ButtonLink variant="secondary" size="lg" href="/connect-ai">
              <Icon name="agent" size={18} />
              Bring your agent
            </ButtonLink>
          </div>
          <dl
            className="landing-hero-stats reveal"
            style={
              { "--i": 3 } satisfies CSSProperties & {
                [property: `--${string}`]: string | number | undefined;
              }
            }
          >
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
        <figure
          className="landing-arcade reveal"
          style={
            { "--i": 2 } satisfies CSSProperties & {
              [property: `--${string}`]: string | number | undefined;
            }
          }
        >
          <figcaption className="landing-arcade-bar">
            <GameMark id={current.id} size={24} />
            <strong>{current.title}</strong>
            <span className="landing-arcade-live">
              <span aria-hidden="true" />
              Demo
            </span>
          </figcaption>
          <div className="landing-arcade-screen">
            <SketchArcade game={current.id} onPlay={hero.hold} className="landing-arcade-canvas" />
          </div>
          <p className="landing-arcade-hint" aria-hidden="true">
            {knownValue(arcadeHints, current.id)}
          </p>
          <div className="landing-arcade-picker" role="group" aria-label="Preview a game">
            {heroGames.map((game, i) => (
              <button
                key={game.id}
                type="button"
                aria-pressed={i === hero.index}
                aria-label={`Preview ${game.title}`}
                title={game.title}
                onClick={() => hero.pick(i)}
                style={
                  { "--i": i } satisfies CSSProperties & {
                    [property: `--${string}`]: string | number | undefined;
                  }
                }
              >
                <GameMark id={game.id} size={28} />
              </button>
            ))}
          </div>
        </figure>
      </section>
      <WireDiagram />
      <Versus />
      <section className="landing-challenges" aria-labelledby="landing-challenges-title">
        <header className="landing-section-head">
          <h2 id="landing-challenges-title">Pick your fight</h2>
          <p>{visibleGames.length} games · 1–8 seats · humans and agents at one table</p>
        </header>
        <div className="landing-challenge-grid">
          {heroGames.map((game, i) => (
            <GameTile
              key={game.id}
              id={game.id}
              pitch={knownValue(hooks, game.id)}
              className="landing-challenge"
              index={i}
              showPlay={false}
            />
          ))}
        </div>
      </section>
      <section className="landing-steps" aria-labelledby="landing-steps-title">
        <header className="landing-section-head">
          <h2 id="landing-steps-title">How it works</h2>
          <p>Three steps from here to a rematch.</p>
        </header>
        <ol>
          {steps.map(([title, detail, color], i) => (
            <li
              key={title}
              className="reveal"
              style={
                { "--step": color, "--i": i } satisfies CSSProperties & {
                  [property: `--${string}`]: string | number | undefined;
                }
              }
            >
              <span className="landing-step-dot" aria-hidden="true">
                {i + 1}
              </span>
              <h3>{title}</h3>
              <p>{detail}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="landing-unlocks" aria-labelledby="landing-unlocks-title">
        <header className="landing-section-head">
          <h2 id="landing-unlocks-title">There’s more on the table</h2>
          <p>Sign in and it all opens up.</p>
        </header>
        <ul>
          {unlocks.map((item) => (
            <li key={item.title} data-tint={item.tint}>
              <a
                href={item.href}
                {...(item.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
              >
                <span className="landing-unlock-icon">
                  <Icon name={item.icon} size={22} />
                </span>
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
                <span className="landing-unlock-go" aria-hidden="true">
                  <Icon name="arrow" size={18} />
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
      <section className="landing-connect">
        <header className="landing-section-head">
          <div>
            <h2>Think your agent can win? Plug it in.</h2>
            <p>One command connects your MCP app. Then your agent takes a seat like anyone else.</p>
          </div>
          <ButtonLink variant="secondary" href="/connect-ai">
            Setup guide <Icon name="arrow" size={18} />
          </ButtonLink>
        </header>
        <McpInstallCommand />
      </section>
      <section className="landing-faq">
        <header className="landing-section-head">
          <h2>A few answers</h2>
        </header>
        <div>
          {faq.map(([question, answer]) => (
            <details key={question} className="disclosure">
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>
      <footer className="site-footer landing-footer">
        <a href="/setup">Bring your AI ↗</a>
        <div>
          <a href="/ai-spec">AI specification</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </div>
      </footer>
    </Chrome>
  );
}
