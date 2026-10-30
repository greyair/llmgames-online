import { useEffect, useLayoutEffect, useState, type CSSProperties, type PointerEvent } from "react";
import { visibleGames } from "./catalog";
import { Chrome } from "./Chrome";
import { GameTile } from "./Library";
import { ButtonLink } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { BilingualText, gameMessage, useT, type MessageKey } from "@/i18n";
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

const heroGames = heroOrder.flatMap((id) => {
  const game = visibleGames.find((game) => game.id === id);

  return game ? [game] : [];
});

const versus = [
  {
    side: "human",
    titleKey: "landing.versus.you",
    lines: [
      ["controller", "landing.versus.youBrowser"],
      ["link", "landing.versus.youJoin"],
      ["clock", "landing.versus.youClock"],
    ],
  },
  {
    side: "agent",
    titleKey: "landing.versus.agent",
    lines: [
      ["agent", "landing.versus.agentMcp"],
      ["info", "landing.versus.agentRules"],
      ["check", "landing.versus.agentMove"],
    ],
  },
] as const satisfies readonly {
  side: string;
  titleKey: MessageKey;
  lines: readonly (readonly [IconName, MessageKey])[];
}[];

const steps = [
  ["landing.steps.pickTitle", "landing.steps.pickDetail", "var(--palette-pink)"],
  ["landing.steps.inviteTitle", "landing.steps.inviteDetail", "var(--palette-sky)"],
  ["landing.steps.settleTitle", "landing.steps.settleDetail", "var(--palette-sun)"],
] as const satisfies readonly (readonly [MessageKey, MessageKey, string])[];

const unlocks = [
  {
    titleKey: "landing.unlocks.series",
    detailKey: "landing.unlocks.seriesDetail",
    href: "/series",
    icon: "trophy",
    tint: "sun",
  },
  {
    titleKey: "landing.unlocks.replay",
    detailKey: "landing.unlocks.replayDetail",
    href: "/history",
    icon: "replay",
    tint: "sky",
  },
  {
    titleKey: "landing.unlocks.jev",
    detailKey: "landing.unlocks.jevDetail",
    href: "/play",
    icon: "spark",
    tint: "pink",
  },
  {
    titleKey: "landing.unlocks.agentLog",
    detailKey: "landing.unlocks.agentLogDetail",
    href: "/agent-log",
    icon: "agent",
    tint: "grass",
  },
  {
    titleKey: "landing.unlocks.mcp",
    detailKey: "landing.unlocks.mcpDetail",
    href: "/connect-ai",
    icon: "link",
    tint: "aqua",
  },
  {
    titleKey: "landing.unlocks.rules",
    detailKey: "landing.unlocks.rulesDetail",
    href: "/ai-spec",
    icon: "info",
    tint: "tomato",
  },
] as const satisfies readonly {
  titleKey: MessageKey;
  detailKey: MessageKey;
  href: string;
  icon: IconName;
  tint: string;
}[];

const faq = [
  ["landing.faq.whatQuestion", "landing.faq.whatAnswer"],
  ["landing.faq.agentVsAgentQuestion", "landing.faq.agentVsAgentAnswer"],
  ["landing.faq.apiKeyQuestion", "landing.faq.apiKeyAnswer"],
  ["landing.faq.humanVsAgentQuestion", "landing.faq.humanVsAgentAnswer"],
] as const satisfies readonly (readonly [MessageKey, MessageKey])[];

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
          <BilingualText k={gameMessage(game.id, "title")} />
        </span>
      ))}
    </span>
  );
}

function Versus() {
  const t = useT();

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
        {t("landing.versus.title")}
      </h2>
      {versus.map((side) => (
        <div key={side.side} className="landing-versus-side" data-side={side.side}>
          <p className="landing-versus-title">{t(side.titleKey)}</p>
          <ul>
            {side.lines.map(([icon, key]) => (
              <li key={key}>
                <Icon name={icon} size={18} />
                {t(key)}
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
  const t = useT();
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
            <BilingualText k="landing.hero.titlePrefix" />
            <span className="sr-only">
              <BilingualText
                k={[
                  heroGames[0] ? gameMessage(heroGames[0].id, "title") : "landing.hero.fallbackGame",
                  "landing.hero.titleSuffix",
                ]}
              />
            </span>
            <RotatingGame index={hero.index} running={hero.running && !hero.held} />
            <BilingualText k="landing.hero.titleSuffix" />
          </h1>
          <p
            className="landing-subline reveal"
            style={
              { "--i": 1 } satisfies CSSProperties & {
                [property: `--${string}`]: string | number | undefined;
              }
            }
          >
            <BilingualText k="landing.hero.subline" />
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
              <BilingualText k="landing.hero.challenge" /> <Icon name="arrow" size={18} />
            </ButtonLink>
            <ButtonLink variant="secondary" size="lg" href="/connect-ai">
              <Icon name="agent" size={18} />
              <BilingualText k="landing.hero.bringAgent" />
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
              <dt>
                <BilingualText k="landing.hero.statGames" />
              </dt>
              <dd>{visibleGames.length}</dd>
            </div>
            <div>
              <dt>
                <BilingualText k="landing.hero.statSeats" />
              </dt>
              <dd>1–8</dd>
            </div>
            <div>
              <dt>
                <BilingualText k="landing.hero.statKeys" />
              </dt>
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
            <strong>
              <BilingualText k={gameMessage(current.id, "title")} />
            </strong>
            <span className="landing-arcade-live">
              <span aria-hidden="true" />
              <BilingualText k="landing.hero.demo" />
            </span>
          </figcaption>
          <div className="landing-arcade-screen">
            <SketchArcade game={current.id} onPlay={hero.hold} className="landing-arcade-canvas" />
          </div>
          <p className="landing-arcade-hint" aria-hidden="true">
            <BilingualText k={gameMessage(current.id, "hint")} />
          </p>
          <div
            className="landing-arcade-picker"
            role="group"
            aria-label={t("landing.hero.previewGroup")}
          >
            {heroGames.map((game, i) => (
              <button
                key={game.id}
                type="button"
                aria-pressed={i === hero.index}
                aria-label={t("landing.hero.previewGame", {
                  game: t(gameMessage(game.id, "title")),
                })}
                title={t(gameMessage(game.id, "title"))}
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
          <h2 id="landing-challenges-title">{t("landing.challenges.title")}</h2>
          <p>{t("landing.challenges.lead", { games: visibleGames.length })}</p>
        </header>
        <div className="landing-challenge-grid">
          {heroGames.map((game, i) => (
            <GameTile
              key={game.id}
              id={game.id}
              pitch={t(gameMessage(game.id, "hook"))}
              className="landing-challenge"
              index={i}
              showPlay={false}
            />
          ))}
        </div>
      </section>
      <section className="landing-steps" aria-labelledby="landing-steps-title">
        <header className="landing-section-head">
          <h2 id="landing-steps-title">{t("landing.steps.title")}</h2>
          <p>{t("landing.steps.lead")}</p>
        </header>
        <ol>
          {steps.map(([titleKey, detailKey, color], i) => (
            <li
              key={titleKey}
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
              <h3>{t(titleKey)}</h3>
              <p>{t(detailKey)}</p>
            </li>
          ))}
        </ol>
      </section>
      <section className="landing-unlocks" aria-labelledby="landing-unlocks-title">
        <header className="landing-section-head">
          <h2 id="landing-unlocks-title">{t("landing.unlocks.title")}</h2>
          <p>{t("landing.unlocks.lead")}</p>
        </header>
        <ul>
          {unlocks.map((item) => (
            <li key={item.titleKey} data-tint={item.tint}>
              <a
                href={item.href}
                {...(item.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
              >
                <span className="landing-unlock-icon">
                  <Icon name={item.icon} size={22} />
                </span>
                <h3>{t(item.titleKey)}</h3>
                <p>{t(item.detailKey)}</p>
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
            <h2>{t("landing.connect.title")}</h2>
            <p>{t("landing.connect.lead")}</p>
          </div>
          <ButtonLink variant="secondary" href="/connect-ai">
            {t("landing.connect.guide")} <Icon name="arrow" size={18} />
          </ButtonLink>
        </header>
        <McpInstallCommand />
      </section>
      <section className="landing-faq">
        <header className="landing-section-head">
          <h2>{t("landing.faq.title")}</h2>
        </header>
        <div>
          {faq.map(([questionKey, answerKey]) => (
            <details key={questionKey} className="disclosure">
              <summary>{t(questionKey)}</summary>
              <p>{t(answerKey)}</p>
            </details>
          ))}
        </div>
      </section>
      <footer className="site-footer landing-footer">
        <a href="/setup">{t("landing.footer.bringAi")}</a>
        <div>
          <a href="/ai-spec">{t("landing.footer.spec")}</a>
          <a href="/privacy">{t("landing.footer.privacy")}</a>
          <a href="/terms">{t("landing.footer.terms")}</a>
        </div>
      </footer>
    </Chrome>
  );
}
