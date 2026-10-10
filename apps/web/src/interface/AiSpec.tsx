import { isString } from "@llmgames/game-catalog";

import { useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icon";
import { Chrome } from "./Chrome";
import { GameMark } from "./GameMark";
import { play } from "@/lib/sound";
import { gameCatalog } from "./catalog";
import { aiSpec, acknowledgement, type GameSpec } from "./aiSpecData";
import { AiSpecBoard } from "./AiSpecBoard";
import "./public.css";
import "./ai-spec.css";

type Channel = "jev" | "mcp";

function HighlightedJson({ source }: { source: string }) {
  const tokens = source.split(
    /("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
  );

  return (
    <>
      {tokens.map((token, index) => {
        if (index % 2 === 0) return token;

        const kind = token.startsWith('"')
          ? token.endsWith(":")
            ? "key"
            : "string"
          : /^(true|false|null)$/.test(token)
            ? "literal"
            : "number";

        return (
          <span key={index} className={`spec-json-${kind}`}>
            {token}
          </span>
        );
      })}
    </>
  );
}

function Code({ title, value }: { title: string; value: unknown }) {
  const [status, setStatus] = useState("Copy");
  const source = isString(value) ? value : JSON.stringify(value, null, 2);

  async function copy() {
    try {
      await navigator.clipboard.writeText(source);
      play("copy");
      setStatus("Copied");
      window.setTimeout(() => setStatus("Copy"), 1600);
    } catch {
      setStatus("Select to copy");
    }
  }

  return (
    <div className="spec-code" data-surface="dark">
      <div className="spec-code-head">
        <span>{title}</span>
        <Button
          size="sm"
          variant="ghost"
          data-sound="none"
          data-copied={status === "Copied" || undefined}
          onClick={() => void copy()}
          aria-label={`Copy ${title}`}
        >
          {status}
        </Button>
      </div>
      <pre tabIndex={0} aria-label={title}>
        <code>
          <HighlightedJson source={source} />
        </code>
      </pre>
    </div>
  );
}

function Exchange({ game, channel }: { game: GameSpec; channel: Channel }) {
  const [phase, setPhase] = useState("battle");
  const [requestIndex, setRequestIndex] = useState(0);

  const example =
    game.id === "battleship" && phase === "placement" ? aiSpec.jev.battleshipPlacement : game.jev;

  const request = example?.requests[requestIndex] ?? example?.requests[0];

  const shortened =
    request && (request.omittedQuestions > 0 || Object.keys(request.omittedCriteria).length > 0);

  const decisionState =
    game.id === "battleship" && phase === "placement"
      ? aiSpec.jev.battleshipPlacement.decisionExample
      : game.decisionExample;

  const action =
    game.id === "battleship" && phase === "placement"
      ? { ...game.sendActionExample, ...aiSpec.jev.battleshipPlacement.action }
      : game.sendActionExample;

  const title = gameCatalog.find((entry) => entry.id === game.id)!.title;

  if (channel === "jev" && !example)
    return (
      <div className="panel spec-unavailable">
        <GameMark id={game.id} size={44} />
        <h2>{title}</h2>
        <p>Hosted Jev is unavailable for Codenames. Select MCP to see how external agents play.</p>
      </div>
    );

  return (
    <section
      className="spec-exchange"
      aria-label={`${title} ${channel === "jev" ? "Jev" : "MCP"} exchange`}
    >
      {game.id === "battleship" && (
        <div className="spec-options segmented" role="group" aria-label="Battleship phase">
          {["placement", "battle"].map((value) => (
            <Button
              key={value}
              size="sm"
              variant="ghost"
              aria-pressed={phase === value}
              onClick={() => {
                setPhase(value);
                setRequestIndex(0);
              }}
            >
              {value === "placement" ? "Fleet placement" : "Battle"}
            </Button>
          ))}
        </div>
      )}
      {channel === "jev" && example && example.requestCount > 1 && (
        <div className="spec-request-options">
          <div className="spec-options segmented" role="group" aria-label="Contexto request">
            {example.requests.map((_, index) => (
              <Button
                key={index}
                size="sm"
                variant="ghost"
                aria-pressed={requestIndex === index}
                onClick={() => setRequestIndex(index)}
              >
                {index === example.requestCount - 1 ? "Final choice" : `Group request ${index + 1}`}
              </Button>
            ))}
          </div>
        </div>
      )}
      <AiSpecBoard
        gameId={game.id}
        value={channel === "jev" ? request?.request.state : decisionState}
      />
      <div className="spec-payloads">
        <div className="panel spec-payload">
          <h3>
            <span className="spec-dir" data-dir="send" aria-hidden="true">
              →
            </span>
            We send {channel === "jev" ? "to Jev" : "via MCP"}
          </h3>
          <Code
            key={`${game.id}-${channel}-${phase}-${requestIndex}-send`}
            title={channel === "jev" ? "POST body" : "wait_for_turn result"}
            value={
              channel === "jev"
                ? request?.request
                : { timedOut: false, reason: "your_turn", revision: 1, state: decisionState }
            }
          />
        </div>
        <div className="panel spec-payload">
          <h3>
            <span className="spec-dir" data-dir="receive" aria-hidden="true">
              ←
            </span>
            We receive {channel === "jev" ? "from Jev" : "via MCP"}
          </h3>
          <Code
            key={`${game.id}-${channel}-${phase}-${requestIndex}-receive`}
            title={channel === "jev" ? "Response body" : "send_action arguments"}
            value={channel === "jev" ? request?.response : action}
          />
          {channel === "jev" && example && (
            <details className="spec-detail">
              <summary>Final mapped game action</summary>
              <Code title="Mapped intent" value={example.action} />
            </details>
          )}
        </div>
      </div>
      <p className="spec-caption">
        Examples from local test rooms.{" "}
        {shortened && channel === "jev" ? "Repeated candidates and questions are shortened. " : ""}
        The server validates every action. Hidden opponent information stays outside the agent’s
        view.
      </p>
      {channel === "mcp" && (
        <details className="spec-detail">
          <summary>Connection and MCP definition</summary>
          <div className="spec-definition">
            <p>
              Connect to <code>{aiSpec.mcp.endpoint}</code> using OAuth 2.1 and Streamable HTTP.
              Each task calls agent_claim once, then creates or joins a room with its controllerId.
            </p>
            <p>
              Call wait_for_turn, choose one action, then send_action. Results are JSON inside MCP
              content text. Each turn runs through the host LLM; no automated play loops.
            </p>
            <Code title="Accepted action result" value={acknowledgement} />
            <Code
              title="send_action input JSON Schema"
              value={aiSpec.mcp.tools.find((tool) => tool.name === "send_action")!.inputSchema}
            />
            <Code
              title={`${title} action definitions`}
              value={game.actions.filter((action) => action.games.length === 1)}
            />
            <a className="public-link" href="/ai-spec.json">
              All tool schemas and game definitions
            </a>
          </div>
        </details>
      )}
    </section>
  );
}

export function AiSpec() {
  const [channel, setChannel] = useState<Channel>("jev");
  const [gameId, setGameId] = useState("connect4");
  useEffect(() => {
    const sync = () => {
      const id = location.hash.slice(1);

      if (gameCatalog.some((game) => game.id === id)) {
        setGameId(id);

        if (id === "codenames") setChannel("mcp");
      }
    };

    sync();
    window.addEventListener("hashchange", sync);

    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const game = aiSpec.games.find((entry) => entry.id === gameId)!;

  return (
    <Chrome active="connect">
      <article className="ai-spec">
        <header className="page-head spec-head">
          <div className="page-head-row">
            <div className="spec-head-copy">
              <h1>How AI plays</h1>
            </div>
            <ButtonLink href="/ai-spec.json" download="llmgames-ai-spec.json" variant="outline">
              Download spec <Icon name="download" size={16} />
            </ButtonLink>
          </div>
        </header>
        <Tabs
          value={channel}
          onValueChange={(value) =>
            value === "jev" || value === "mcp" ? setChannel(value) : undefined
          }
        >
          <TabsList className="spec-channel-switch" aria-label="AI connection">
            <TabsTrigger value="jev">Jev</TabsTrigger>
            <TabsTrigger value="mcp">MCP</TabsTrigger>
          </TabsList>
          <div className="spec-game-picker" role="group" aria-label="Choose a game">
            {gameCatalog.map((entry) => (
              <Button
                key={entry.id}
                size="sm"
                variant="outline"
                aria-pressed={gameId === entry.id}
                onClick={() => setGameId(entry.id)}
              >
                <GameMark id={entry.id} size={20} />
                {entry.title}
              </Button>
            ))}
          </div>
          <TabsContent value="jev">
            <Exchange key={`${gameId}-jev`} game={game} channel="jev" />
          </TabsContent>
          <TabsContent value="mcp">
            <Exchange key={`${gameId}-mcp`} game={game} channel="mcp" />
          </TabsContent>
        </Tabs>
        <footer className="spec-footer">
          <a href="/connect-ai" className="public-link">
            Connect your agent
          </a>
          <a href="/ai-spec.json" className="public-link">
            Full JSON specification
          </a>
        </footer>
      </article>
    </Chrome>
  );
}
