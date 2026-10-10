import { knownValue } from "@/domain/view-contracts";
import { isWireObject, type WireValue } from "@llmgames/game-catalog";
import { isNumber, isString } from "@llmgames/game-catalog";

import { receiveClock } from "@/game-ui/useMatchClock";
import { isGameEnabled } from "@llmgames/game-catalog";
import { GameMark } from "./GameMark";
import { GameGlyph } from "./Library";
import { LobbySetup } from "@/game-ui/LobbySetup";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Button, ButtonLink, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import { getCurrentUser, refreshCurrentUser, type User } from "@/services/auth";
import { go, useBrowserHref } from "@/lib/navigate";
import { play } from "@/lib/sound";
import { GameSocket, createGameRoom, joinGameRoom } from "@/services/gameSocket";
import { clientViewSchema, type ClientView } from "@/domain/game-state";
import {
  parseRewatch,
  readOnlyReplayState,
  type RewatchPayload,
} from "@/features/replay/rewatchPayload";
import { MatchDesk } from "@/game-ui/MatchDesk";
import { GameBoard } from "@/game-ui/GameBoard";
import { Chrome } from "./Chrome";
import { gameRoute, getGame } from "./catalog";
import { rules } from "./gameRules";
import { HoleyLoader } from "@/components/ui/holey-loader";
import { LoadingPanel } from "@/components/ui/loading-panel";
import "./room.css";

const errorText = <T,>(e: T) =>
  e instanceof Error ? e.message : "Could not connect. Please try again.";

const choiceSpring = { type: "spring", stiffness: 560, damping: 36 } as const;

function Choices<T extends number>({
  legend,
  name,
  values,
  value,
  suffix,
  onChange,
}: {
  legend: string;
  name: string;
  values: T[];
  value: T;
  suffix: string;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="room-choice-group">
      <legend>{legend}</legend>
      <div className="room-pace-options">
        {values.map((option) => (
          <button
            key={option}
            type="button"
            className="room-choice"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
          >
            {value === option && (
              <motion.span
                layoutId={`room-choice-${name}`}
                className="room-choice-fill"
                aria-hidden="true"
                transition={choiceSpring}
              />
            )}
            <span className="room-choice-label">
              {option}
              {suffix}
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function RuleText({ rule }: { rule: string }) {
  const split = rule.indexOf(". ");

  if (split < 0 || split > 60) return <span>{rule}</span>;

  return (
    <span>
      <strong>{rule.slice(0, split + 1)}</strong> {rule.slice(split + 2)}
    </span>
  );
}

function Stage({
  gameType,
  className,
  children,
}: {
  gameType: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={["room-stage", className].filter(Boolean).join(" ")} data-game={gameType}>
      {children}
    </div>
  );
}

const CONNECTION_RECOVERY_DELAY = 4000;

type RoomLink = { roomId: string; roomCode: string; gameType: string };

export function Room({
  gameType,
  demo,
  seriesRoom,
  onSeriesReturn,
}: {
  gameType: string;
  seriesRoom?: RoomLink;
  onSeriesReturn?: () => void;
  demo?: {
    user: User;
    state?: ClientView;
    readyState: ClientView;
    error?: string;
    confirm?: boolean;
  };
}) {
  const game = getGame(gameType)!;
  const gameRules = knownValue(rules, gameType) ?? [];
  const roomQuery = new URLSearchParams(useBrowserHref().split("?")[1] ?? "");

  const roomCode =
    seriesRoom?.roomCode ??
    (roomQuery.get("roomCode") ?? roomQuery.get("room"))?.toUpperCase() ??
    null;

  const [ownAvatar, setOwnAvatar] = useState<User | undefined>(demo?.user);
  const [authenticated, setAuthenticated] = useState(Boolean(demo));
  const [error, setError] = useState(demo?.error ?? "");
  const [busy, setBusy] = useState(false);
  const [entryAction, setEntryAction] = useState<"create" | "join" | null>(null);

  const [room, setRoom] = useState<RoomLink | null>(
    demo?.state ? { roomId: "preview-room", roomCode: "DEMO42", gameType } : null,
  );

  const [state, setState] = useState<ClientView | null>(demo?.state ?? null);
  const [connected, setConnected] = useState(Boolean(demo));
  const [connectionSlow, setConnectionSlow] = useState(false);
  const [authExpired, setAuthExpired] = useState(false);
  const [code, setCode] = useState(roomCode ?? "");
  const [minutes, setMinutes] = useState(30);
  const [seconds, setSeconds] = useState(30);
  const [exit, setExit] = useState(Boolean(demo?.confirm));
  const [end, setEnd] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [replay, setReplay] = useState<RewatchPayload | null>(null);
  const [frame, setFrame] = useState<number | null>(null);
  const socket = useRef<GameSocket | null>(null);

  const leaving = useRef(false),
    terminalReceived = useRef(false);

  useEffect(() => {
    if (roomCode) setCode(roomCode);
  }, [roomCode]);
  useEffect(() => {
    if (demo || leaving.current) return;
    let active = true;
    getCurrentUser()
      .then(async (user) => {
        if (!active || leaving.current) return;
        const returnTo = encodeURIComponent(location.pathname + location.search);

        if (!user) {
          go("/login?returnTo=" + returnTo, "replace");

          return;
        }

        if (user.gamertag_selected !== 1) {
          go("/onboarding?returnTo=" + returnTo, "replace");

          return;
        }

        setOwnAvatar(user);
        setAuthenticated(true);

        if (roomCode) {
          setEntryAction("join");
          setBusy(true);

          try {
            const result = await joinGameRoom({ roomCode });

            if (active) acceptRoom(result);
          } catch (e) {
            if (active) setError(errorText(e));
          } finally {
            if (active) setBusy(false);
          }
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });

    return () => {
      active = false;
    };
  }, [demo, gameType, roomCode]);
  useEffect(() => {
    if (demo || !room || connected) {
      setConnectionSlow(false);

      return;
    }

    const timer = setTimeout(() => {
      setConnectionSlow(true);
      void refreshCurrentUser()
        .then((user) => {
          if (!user) {
            setAuthenticated(false);
            setAuthExpired(true);
          }
        })
        .catch(() => {});
    }, CONNECTION_RECOVERY_DELAY);

    return () => clearTimeout(timer);
  }, [connected, demo, room]);
  useEffect(() => {
    if (demo || !room || leaving.current) return;
    const client = new GameSocket(room.roomId);
    socket.current = client;
    setConnected(false);
    setState(null);
    setError("");

    if (!seriesRoom)
      history.replaceState(
        null,
        "",
        `${gameRoute(room.gameType)}?roomCode=${encodeURIComponent(room.roomCode)}`,
      );

    const receive = (value: WireValue) => {
      const incoming = clientViewSchema.safeParse(value).data;

      if (leaving.current || !incoming || (terminalReceived.current && incoming.status !== "ended"))
        return;

      if (incoming.status === "ended") terminalReceived.current = true;
      setState(receiveClock({ ...incoming, type: room.gameType, roomCode: room.roomCode }));
    };

    const stopConnect = client.onConnect((data) => receive(data.state));

    const stopConnection = client.onConnectionChange((value) => {
      setConnected(value);

      if (value) {
        setAuthenticated(true);
        setConnectionSlow(false);
        setAuthExpired(false);
      }
    });

    const stopMessages = client.onMessage((message) => {
      const payload = isWireObject(message.payload) ? message.payload : {};

      if (message.type === "state") receive(message.payload);

      if (message.type === "game_started") receive(payload.state);

      if (message.type === "game_ended") {
        receive(payload.finalState);
        setReplay(parseRewatch(payload.rewatch, room.gameType));
      }

      if (message.type === "timer_tick" || message.type === "timer_sync")
        setState((old) => {
          if (!old) return old;
          const next = { ...old, turnState: old.turnState ? { ...old.turnState } : undefined };

          if (isNumber(payload.gameTimeRemaining))
            next.gameTimeRemaining = payload.gameTimeRemaining;

          if (next.turnState && isNumber(payload.turnTimeRemaining))
            next.turnState.turnTimeRemaining = payload.turnTimeRemaining;

          return next;
        });

      if (message.type === "error") {
        const message = isString(payload.message)
          ? payload.message
          : isString(payload.error)
            ? payload.error
            : "The server could not accept that action.";

        if (
          !(
            room.gameType === "contexto" && message === "That word is not in this game's dictionary"
          )
        )
          setError(message);
      }
    });

    client.connect(room.roomCode);

    return () => {
      stopConnect();
      stopConnection();
      stopMessages();
      client.disconnect();

      if (socket.current === client) socket.current = null;
    };
  }, [room]);

  function acceptRoom(result: RoomLink) {
    if (leaving.current) return;

    if (result.gameType !== gameType) {
      go(
        `${gameRoute(result.gameType)}?roomCode=${encodeURIComponent(result.roomCode)}`,
        "replace",
      );

      return;
    }

    setRoom((current) =>
      current?.roomId === result.roomId && current.roomCode === result.roomCode ? current : result,
    );
  }

  async function enter(create: boolean) {
    if (busy) return;
    setEntryAction(create ? "create" : "join");

    if (demo) {
      setRoom({ roomId: "preview-room", roomCode: "DEMO42", gameType });
      setState({ ...demo.readyState, status: "waiting" });

      return;
    }

    setBusy(true);
    setError("");

    try {
      acceptRoom(
        create
          ? await createGameRoom({
              gameType,
              gameTotalTime: minutes * 60000,
              turnTime: seconds * 1000,
            })
          : await joinGameRoom({ roomCode: code.trim().toUpperCase() }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function send(action: string, data: WireValue = {}) {
    if (demo) {
      if (action === "add_jev" || action === "remove_jev") {
        setState((current) => {
          if (!current) return current;

          const next = {
            ...current,
            players: (current.players ?? []).filter((p) => p.id !== "preview-jev"),
            jev: { available: true, status: "ready" as const },
          };

          return action === "remove_jev"
            ? next
            : {
                ...next,
                players: [
                  ...next.players,
                  {
                    id: "preview-jev",
                    name: "Jev",
                    codename: "Jev",
                    isAgent: true,
                    environmentLabel: "TypeSafe",
                  },
                ],
                jev: { ...next.jev, playerId: "preview-jev" },
              };
        });
        setError("");

        return true;
      }

      setError("Demo intent: " + action);

      if (action === "start_game") setState(demo.readyState);

      return;
    }

    if (!connected || !socket.current?.isConnected) {
      setConnected(false);
      setError("Reconnecting. Wait for the room before making a move.");

      return false;
    }

    setError("");
    socket.current.sendAction(action, data);

    return true;
  }

  function retryConnection() {
    if (!room) return;
    setConnectionSlow(false);
    setError("");
    setRoom({ ...room });
  }

  function leave() {
    if (onSeriesReturn) {
      onSeriesReturn();

      return;
    }

    leaving.current = true;

    if (demo) {
      go("/design-preview/library");

      return;
    }

    socket.current?.leave();
    socket.current?.disconnect();
    setRoom(null);
    go("/play");
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(location.href);
      setInviteCopied(true);
      setCodeCopied(false);
      play("copy");
    } catch {
      setError("Could not copy the invite link.");
    }
  }

  async function copyRoomCode() {
    const value = state?.roomCode ?? room?.roomCode;

    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setCodeCopied(true);
      setInviteCopied(false);
      play("copy");
    } catch {
      setError("Could not copy the room code.");
    }
  }

  const signInHref = () =>
    `/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`;

  if (
    !state &&
    isGameEnabled(gameType) &&
    (room || (!authenticated && !error) || (roomCode && !error))
  )
    return (
      <Chrome authenticated={authenticated} user={ownAvatar}>
        <Stage gameType={gameType} className="room-loading">
          <LoadingPanel
            label={
              authExpired
                ? "Your session expired"
                : !authenticated
                  ? "Checking your account…"
                  : connectionSlow
                    ? "Still trying to connect…"
                    : "Connecting to game…"
            }
          >
            {error && (
              <p role="alert" className="room-error">
                {error}
              </p>
            )}
            {room && authExpired && (
              <>
                <p className="room-loading-note">
                  Your place in the room is saved. Sign in to return.
                </p>
                <a className={buttonVariants({})} href={signInHref()}>
                  Sign in again
                </a>
              </>
            )}
            {room && connectionSlow && !authExpired && (
              <>
                <p className="room-loading-note">This is taking longer than expected.</p>
                <Button variant="secondary" onClick={retryConnection}>
                  Try again
                </Button>
              </>
            )}
          </LoadingPanel>
        </Stage>
      </Chrome>
    );

  if (!state)
    return (
      <Chrome authenticated={authenticated} user={ownAvatar}>
        <Stage gameType={gameType} className="room-entry">
          <div className="room-entry-layout">
            <header className="room-entry-game-summary" data-surface="dark">
              <GameGlyph id={gameType} />
              <div className="room-entry-mark reveal-pop">
                <GameMark id={gameType} size={72} />
                <span className="room-entry-meta">
                  {game.players} players<span aria-hidden="true"> · </span>
                  {game.category}
                </span>
              </div>
              <h1
                id="room-entry-title"
                className="reveal"
                style={
                  { "--i": 1 } satisfies CSSProperties & {
                    [property: `--${string}`]: string | number | undefined;
                  }
                }
              >
                {game.title}
              </h1>
              <p
                className="room-entry-lead reveal"
                style={
                  { "--i": 2 } satisfies CSSProperties & {
                    [property: `--${string}`]: string | number | undefined;
                  }
                }
              >
                {game.detail}
              </p>
            </header>
            <section
              className="room-entry-settings reveal"
              style={
                { "--i": 3 } satisfies CSSProperties & {
                  [property: `--${string}`]: string | number | undefined;
                }
              }
              aria-label="Game settings"
            >
              {error && (
                <p role="alert" className="room-error">
                  {error}
                </p>
              )}
              {!demo && !isGameEnabled(gameType) ? (
                <div role="status" className="room-unavailable">
                  <p>This game is currently unavailable.</p>
                  <ButtonLink href="/play" variant="secondary">
                    Browse available games
                  </ButtonLink>
                </div>
              ) : !authenticated ? (
                error ? (
                  <p role="status">
                    <Button onClick={() => location.reload()}>Retry account check</Button>
                  </p>
                ) : (
                  <HoleyLoader label="Checking your account…" />
                )
              ) : room ? (
                <div className="room-connection">
                  <HoleyLoader
                    label={connectionSlow ? "Still trying to connect…" : "Connecting to game…"}
                  />
                  {connectionSlow && (
                    <>
                      <p>This is taking longer than expected.</p>
                      <div className="room-connection-actions">
                        <Button variant="secondary" onClick={retryConnection}>
                          Try again
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <form
                    className="room-create-form"
                    aria-label="Create a room"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void enter(true);
                    }}
                  >
                    <Choices
                      legend="Match length"
                      name="minutes"
                      values={[10, 15, 20, 30, 45]}
                      value={minutes}
                      suffix="m"
                      onChange={setMinutes}
                    />
                    {gameType !== "contexto" && (
                      <Choices
                        legend="Time per turn"
                        name="seconds"
                        values={[30, 60, 90, 120, 150]}
                        value={seconds}
                        suffix="s"
                        onChange={setSeconds}
                      />
                    )}
                    <div className="room-create-action">
                      <Button
                        type="submit"
                        size="lg"
                        className="room-create-button"
                        disabled={busy}
                        aria-busy={busy && entryAction === "create"}
                      >
                        {busy && entryAction === "create" ? "Creating room…" : "Create room"}
                        <Icon name="arrow" size={20} />
                      </Button>
                      <p className="room-opponent-help">
                        {[
                          "connect4",
                          "checkers",
                          "reversi",
                          "pokemon",
                          "poker",
                          "battleship",
                          "contexto",
                        ].includes(gameType)
                          ? "Create a room to invite a friend or add Jev, an AI opponent."
                          : "Create a room and share the invite with your players."}
                      </p>
                    </div>
                  </form>
                  <form
                    className="room-join-form"
                    aria-label="Join a game room"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void enter(false);
                    }}
                  >
                    <label htmlFor="game-room-code">Have a room code?</label>
                    <div className="room-join-controls">
                      <Input
                        id="game-room-code"
                        disabled={busy}
                        aria-label="Room code"
                        placeholder="ROOM CODE"
                        value={code}
                        onChange={(e) => setCode(e.target.value.toUpperCase())}
                        autoComplete="off"
                        spellCheck={false}
                        required
                        maxLength={12}
                      />
                      <Button
                        type="submit"
                        variant="secondary"
                        disabled={busy || !code.trim()}
                        aria-busy={busy && entryAction === "join"}
                      >
                        {busy && entryAction === "join" ? "Joining…" : "Join"}
                      </Button>
                    </div>
                  </form>
                </>
              )}
            </section>
            <section
              className="room-entry-rules reveal"
              style={
                { "--i": 4 } satisfies CSSProperties & {
                  [property: `--${string}`]: string | number | undefined;
                }
              }
              aria-labelledby="room-instructions-title"
            >
              <h2 id="room-instructions-title">How to play</h2>
              <ol role="list">
                {gameRules.map((rule, index) => (
                  <li key={rule}>
                    <span className="room-rule-number" aria-hidden="true">
                      {index + 1}
                    </span>
                    <RuleText rule={rule} />
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </Stage>
      </Chrome>
    );

  const viewing =
    frame !== null && replay
      ? { ...readOnlyReplayState(replay.frames[frame]!.state), type: room!.gameType }
      : state;

  const shown =
    frame !== null
      ? { ...viewing, replayReadOnly: true }
      : !connected
        ? { ...viewing, you: { ...viewing.you, isYourTurn: false, legalActions: [] } }
        : viewing;

  const host = state.you?.isHost;

  return (
    <>
      <MatchDesk
        state={shown}
        finalReveal={replay?.frames.at(-1)?.state}
        onExit={() => (state.status === "ended" ? leave() : setExit(true))}
        controls={
          <div className="room-controls">
            {host && state.status !== "waiting" && state.status !== "ended" && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setEnd(true)}>
                  End game
                </Button>
              </>
            )}
            {replay && (
              <>
                <Button
                  size="sm"
                  variant={frame === null ? "default" : "secondary"}
                  onClick={() => setFrame(frame === null ? 0 : null)}
                >
                  {frame === null ? "Watch replay" : "Back to result"}
                </Button>
                {frame !== null && (
                  <label>
                    Move {frame + 1} of {replay.frames.length}
                    <input
                      aria-label="Replay position"
                      type="range"
                      min={0}
                      max={replay.frames.length - 1}
                      value={frame}
                      onChange={(e) => setFrame(Number(e.target.value))}
                    />
                  </label>
                )}
              </>
            )}
          </div>
        }
      >
        <div className="room-match-notices">
          {error && (
            <p role="alert" className="room-error">
              {error}
            </p>
          )}
          {!connected && state.status !== "ended" && (
            <div className="room-reconnect">
              {authExpired ? (
                <>
                  <span>Your session expired.</span>
                  <a className={buttonVariants({ size: "sm" })} href={signInHref()}>
                    Sign in again
                  </a>
                </>
              ) : (
                <>
                  <HoleyLoader compact showLabel label="Reconnecting…" size={22} />
                  {connectionSlow && (
                    <Button size="sm" variant="secondary" onClick={retryConnection}>
                      Try again
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        {state.status === "waiting" ? (
          <LobbySetup
            state={state}
            connected={connected}
            error={error}
            send={send}
            onClose={() => setEnd(true)}
            onCopyCode={() => void copyRoomCode()}
            onCopyInvite={() => void copyInvite()}
            codeCopied={codeCopied}
            inviteCopied={inviteCopied}
          />
        ) : (
          <GameBoard state={shown} send={send} />
        )}
      </MatchDesk>
      <Dialog
        open={exit || end}
        onOpenChange={(open) => {
          if (!open) {
            setExit(false);
            setEnd(false);
          }
        }}
      >
        <DialogContent>
          <DialogTitle>{end ? "End this game?" : "Leave this game?"}</DialogTitle>
          <DialogDescription>
            {end
              ? "This ends the room for every player."
              : "The match can continue without you. You can return using the room link while it remains active."}
          </DialogDescription>
          <DialogFooter>
            <DialogClose className={buttonVariants({ variant: "secondary" })}>
              Keep playing
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (end) {
                  if (send("end_game")) setEnd(false);
                } else leave();
              }}
            >
              {end ? "End game" : "Leave game"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
