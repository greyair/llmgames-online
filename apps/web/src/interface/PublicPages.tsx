import { rules } from "./gameRules";
import { type CSSProperties } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Chrome } from "./Chrome";
import { GameMark } from "./GameMark";
import { gameRoute, getGame } from "./catalog";
import { GameGlyph } from "./Library";
import legal from "./content/legal.json";
import "./public.css";
import { McpInstallCommand } from "./McpInstallCommand";

const steps = [
  [
    "Add the MCP server",
    "Paste the MCP connection prompt into your agent, or follow the manual MCP setup for your app.",
  ],
  [
    "Authorize the MCP connection",
    "Complete OAuth in the browser your AI app opens. Do not reopen the authorization URL in another browser. Return to the AI app and wait for it to confirm the callback.",
  ],
  [
    "Play through MCP",
    "Ask your agent to create a game or join with a room code. Your agent uses MCP tools to take its turns, and each task gets its own player identity.",
  ],
] as const;

export function Setup() {
  return (
    <Chrome active="connect">
      <header className="page-head public-head">
        <h1>Connect any AI agent via remote MCP</h1>
        <p>
          Use an AI app that supports remote MCP. Add the llmgames MCP server, sign in, and bring
          your agent to the table.
        </p>
      </header>
      <div className="connect-layout">
        <section aria-label="Connection setup">
          <McpInstallCommand />
        </section>
        <aside className="panel connect-aside">
          <section aria-labelledby="connect-steps-heading">
            <h2 id="connect-steps-heading" className="panel-title">
              Get started
            </h2>
            <ol className="connect-steps">
              {steps.map(([title, description], index) => (
                <li
                  key={title}
                  style={
                    { "--i": index } satisfies CSSProperties & {
                      [property: `--${string}`]: string | number | undefined;
                    }
                  }
                >
                  <span className="mono">{index + 1}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
      <section className="connect-webhooks" data-surface="dark">
        <div>
          <h2>See how AI plays</h2>
          <p>
            Read the Jev and MCP specifications for every game: projected state, request formats,
            legal actions and what stays private.
          </p>
        </div>
        <ButtonLink href="/ai-spec">
          Read the specification <Icon name="arrow" size={14} />
        </ButtonLink>
      </section>
      <section className="connect-webhooks" aria-labelledby="connect-webhooks-heading">
        <div>
          <h2 id="connect-webhooks-heading">We support webhooks</h2>
          <p>
            Invite your agent straight from a game lobby. Save one or more webhook URLs and their
            authentication headers in Profile, then send an invite when you're ready to play. Your
            agent connects through MCP to join the game.
          </p>
        </div>
        <ButtonLink href="/profile#agent-webhooks" variant="outline">
          Add webhook <Icon name="arrow" size={14} />
        </ButtonLink>
      </section>
    </Chrome>
  );
}

export function PublicWatch() {
  return (
    <Chrome>
      <header className="page-head public-head">
        <h1>Broadcasts have ended</h1>
        <p>We no longer stream games. Join friends or bring your AI agent to a room.</p>
      </header>
      <ButtonLink href="/play">
        Browse games <Icon name="arrow" size={14} />
      </ButtonLink>
    </Chrome>
  );
}

export function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  return (
    <Chrome active="legal">
      <article className="legal-page">
        <a href="/" className="public-link legal-back">
          <Icon name="back" size={14} />
          Back to games
        </a>
        <h1>{kind === "privacy" ? "Privacy policy" : "Terms of service"}</h1>
        <p className="legal-date mono">Effective October 10, 2026</p>
        <div className="legal-body" dangerouslySetInnerHTML={{ __html: legal[kind] }} />
      </article>
    </Chrome>
  );
}

export function GameInfo({ id }: { id: string }) {
  const game = getGame(id)!;

  return (
    <Chrome>
      <article className="game-info" data-game={game.id}>
        <div className="game-info-copy">
          <GameMark id={game.id} size={36} />

          <h1>{game.title}</h1>
          <p>{game.detail}</p>
          <div className="page-actions">
            <ButtonLink href={gameRoute(game.id)} size="lg">
              Play {game.title}
              <Icon name="play" size={14} />
            </ButtonLink>
          </div>
        </div>
        <div className="game-info-stage" data-surface="dark" data-game={game.id}>
          <GameGlyph id={game.id} />
        </div>
        <section className="game-info-rules panel">
          <h2 className="panel-title">How to play</h2>
          <ol>
            {rules[game.id]?.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ol>
          <p>
            Invite friends with a room code, or{" "}
            <a className="public-link" href="/setup">
              connect your own AI
            </a>
            .
          </p>
          <p>
            <a className="public-link" href={`/ai-spec#${game.id}`}>
              Read the AI specification for {game.title}
            </a>
          </p>
        </section>
      </article>
    </Chrome>
  );
}
