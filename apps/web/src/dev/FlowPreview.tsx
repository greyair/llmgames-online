import { useEffect, useState } from "react";
import { AccountPreview } from "@/interface/Account";
import { Archive } from "@/interface/Archive";
import { Room } from "@/interface/Room";
import { Chrome } from "@/interface/Chrome";
import { Button } from "@/components/ui/button";
import { go } from "@/lib/navigate";
import { fixture } from "./previewFixtures";
import { applyPreviewScenario } from "./previewScenarios";
import { installPreviewApi, previewUser } from "./previewApi";
import { LoadingPanel } from "@/components/ui/loading-panel";
import type { RoomChatEntry } from "@/domain/chat";

/** A seeded conversation so the chat drawer can be reviewed without a socket. */
const chatPreviewEntries: RoomChatEntry[] = [
  {
    seq: 1,
    id: "preview-1",
    senderPlayerId: "player-host",
    text: "开一局宝可梦？我这边已经准备好了。",
    mentions: [],
    createdAt: 1,
    author: {
      playerId: "player-host",
      displayName: "Alex",
      seatKind: "human",
      isHost: true,
      isSpectator: false,
    },
  },
  {
    seq: 2,
    id: "preview-2",
    senderPlayerId: "player-agent",
    text: "已就位，等你先出招。",
    mentions: [],
    createdAt: 2,
    author: {
      playerId: "player-agent",
      displayName: "Codex · 皮卡丘",
      seatKind: "mcp",
      isHost: false,
      isSpectator: false,
      environmentLabel: "Codex",
    },
  },
  {
    seq: 3,
    id: "preview-3",
    senderPlayerId: "player-bot",
    text: "（规则 Bot）随时可以开始。",
    mentions: [],
    createdAt: 3,
    author: {
      playerId: "player-bot",
      displayName: "反射壁小子",
      seatKind: "bot",
      isHost: false,
      isSpectator: false,
    },
  },
  {
    seq: 4,
    id: "preview-4",
    senderPlayerId: "player-host",
    text: "@Codex 你先手吧，我看看你的十万伏特。",
    mentions: ["player-agent"],
    createdAt: 4,
    author: {
      playerId: "player-host",
      displayName: "Alex",
      seatKind: "human",
      isHost: true,
      isSpectator: false,
    },
  },
];

export function FlowPreview({ screen, mode }: { screen: string; mode: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const restore = installPreviewApi({
      typesafeConnected: mode === "jev-connected",
      trialAvailable: mode !== "jev-trial-used",
    });

    setReady(true);

    return restore;
  }, [mode]);

  if (!ready)
    return (
      <Chrome user={previewUser}>
        <LoadingPanel label="Loading preview…" />
      </Chrome>
    );

  if (mode === "signed-out" || mode.startsWith("auth-") || screen === "profile")
    return <AccountPreview state={screen === "profile" ? mode : mode} user={previewUser} />;

  if (screen === "history" || screen === "agent-log")
    return <Archive kind={screen === "history" ? "history" : "agents"} />;

  const game = ["setup", "library"].includes(screen)
    ? "connect4"
    : screen === "placement"
      ? "battleship"
      : screen;

  const readyState = applyPreviewScenario(fixture(game), game, "playing");
  const view = applyPreviewScenario(fixture(game), game, mode);

  return (
    <Room
      gameType={game}
      demo={{
        user: previewUser,
        readyState,
        state:
          mode === "room-setup" || (screen === "setup" && mode === "playing") ? undefined : view,
        error:
          mode === "action-error"
            ? "That move could not be accepted. Choose an available action and try again."
            : undefined,
        confirm: mode === "leave-confirmation",
        chat: mode.startsWith("chat")
          ? { entries: chatPreviewEntries, unread: 2, open: mode === "chat-open" }
          : undefined,
      }}
    />
  );
}

export function OAuthPreview({ state }: { state: string }) {
  const [connected, setConnected] = useState(state === "connected");
  const expired = state === "expired";

  return (
    <main className="oauth-page">
      <section className="signin-page">
        <header className="signin-head">
          <h1>{expired ? "Request expired" : connected ? "Agent connected" : "Connect Codex"}</h1>
          <p>
            {expired
              ? "Return to your AI app and start a new connection request."
              : connected
                ? "Return to your AI app to claim a seat and join a game."
                : "Choose whether to let this agent use your llmgames account."}
          </p>
        </header>
        <div className="signin-card">
          {!expired && (
            <>
              <p className="oauth-client">
                Requesting client: <strong>Codex</strong>
              </p>
              <div className="oauth-account">
                <span className="oauth-account-avatar" aria-hidden="true">
                  A
                </span>
                <div>
                  <strong>Alex</strong>
                  <span>alex@example.test</span>
                </div>
                {!connected && <a href="/design-preview/library?state=signed-out">Change</a>}
              </div>
            </>
          )}
          {!expired && !connected ? (
            <>
              <div className="oauth-permissions">
                <p>This connection can</p>
                <ul>
                  <li>Create and join multiplayer rooms</li>
                  <li>Claim agent seats owned by your account</li>
                  <li>Send game actions when you ask it to play</li>
                </ul>
              </div>
              <div className="oauth-actions">
                <Button size="lg" onClick={() => setConnected(true)}>
                  Allow connection
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  onClick={() => go("/design-preview/public/landing")}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <Button size="lg" variant="outline" onClick={() => go("/setup")}>
              Connection guide ↗
            </Button>
          )}
        </div>
        <p className="account-footnote">
          <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
        </p>
      </section>
    </main>
  );
}
