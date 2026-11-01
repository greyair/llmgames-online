import { knownValue } from "@/domain/view-contracts";
import { isWireObject, type WireValue } from "@llmgames/game-catalog";
import { isNumber, isString } from "@llmgames/game-catalog";

import { receiveClock } from "@/game-ui/useMatchClock";
import { isGameEnabled, maxGameTotalTimeMs } from "@llmgames/game-catalog";
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
import { clientViewContract, clientViewSchema, type ClientView } from "@/domain/game-state";
import { gameOptionsFor } from "@llmgames/game-catalog";
import { optionChoiceLabel, optionTitle } from "@/game-ui/gameOptions";
import {
  parseRewatch,
  readOnlyReplayState,
  type RewatchPayload,
} from "@/features/replay/rewatchPayload";
import { MatchDesk } from "@/game-ui/MatchDesk";
import { GameBoard } from "@/game-ui/GameBoard";
import { RoomChat } from "@/game-ui/RoomChat";
import { chatEntrySchema, chatPageSchema, mergeChat, type RoomChatEntry } from "@/domain/chat";
import { Chrome } from "./Chrome";
import { gameRoute, getGame } from "./catalog";
import { gameMessage, useLocale, useT, type GameField } from "@/i18n";
import { ERROR_MESSAGE_KEYS, isRoomErrorCode } from "@/i18n/errorMessages";
import { rules } from "./gameRules";
import { rulesZhCN } from "./gameRules.zh-CN";
import { HoleyLoader } from "@/components/ui/holey-loader";
import { LoadingPanel } from "@/components/ui/loading-panel";
import "./room.css";

/** Server messages stay English (they are protocol text); only the fallback is localized. */
const errorText = <T,>(e: T, fallback: string) => (e instanceof Error ? e.message : fallback);

const choiceSpring = { type: "spring", stiffness: 560, damping: 36 } as const;

function Choices<T extends string | number>({
  legend,
  name,
  values,
  value,
  suffix,
  format,
  onChange,
}: {
  legend: string;
  name: string;
  values: T[];
  value: T;
  suffix?: string;
  /** Display text for a value; the raw value is the default. */
  format?: (value: T) => string;
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
              {format ? format(option) : option}
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

/** Match lengths offered in the lobby; filtered by each game's own maximum. */
const MATCH_MINUTES = [10, 15, 20, 30, 45, 60, 90];

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
  const t = useT();
  const locale = useLocale();
  const game = getGame(gameType)!;
  const gameRules = knownValue(locale === "zh-CN" ? rulesZhCN : rules, gameType) ?? [];

  // Game copy lives in the shared namespace; catalog text is the fallback until a
  // game ships its own translations.
  const gameText = (field: GameField, fallback: string) => {
    const key = gameMessage(gameType, field);

    const text = t(key);

    return text === key ? fallback : text;
  };

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

  // Rule options this game declares (C2). Defaults come from the shared
  // catalog, so the lobby can never show a value the server would refuse.
  const optionSpecs = gameOptionsFor(gameType);

  const [optionValues, setOptionValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(optionSpecs.map((spec) => [spec.key, spec.default])),
  );

  const [exit, setExit] = useState(Boolean(demo?.confirm));
  const [end, setEnd] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [replay, setReplay] = useState<RewatchPayload | null>(null);
  const [frame, setFrame] = useState<number | null>(null);
  const [chatEntries, setChatEntries] = useState<RoomChatEntry[]>([]);
  const [chatUnread, setChatUnread] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatPolicy, setChatPolicy] = useState({ spectatorSpeech: true });
  const socket = useRef<GameSocket | null>(null);
  /** The socket handlers outlive a render, so identity and panel state live in refs. */
  const chatOpenRef = useRef(false);
  const selfIdRef = useRef<string | undefined>(undefined);

  chatOpenRef.current = chatOpen;

  // Each game declares how long its matches may run, so the picker adapts.
  const minuteChoices = MATCH_MINUTES.filter(
    (value) => value * 60_000 <= maxGameTotalTimeMs(gameType),
  );

  const chosenMinutes = minuteChoices.includes(minutes)
    ? minutes
    : Math.max(...minuteChoices, 10);

  const leaving = useRef(false),
    terminalReceived = useRef(false),
    rejectedViewReported = useRef(false);

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
            if (active) setError(errorText(e, t("room.connectFailed")));
          } finally {
            if (active) setBusy(false);
          }
        }
      })
      .catch((e) => {
        if (active) setError(errorText(e, t("room.connectFailed")));
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

    // A frame the contract rejects is dropped, and a dropped frame looks exactly
    // like a room that never starts. Name the offending field path once per
    // connection; never the frame itself, which can carry private state.
    const reportRejectedView = (value: WireValue) => {
      if (rejectedViewReported.current) return;

      rejectedViewReported.current = true;

      const issues = clientViewContract.safeParse(value).error?.issues ?? [];

      console.warn(
        "Dropped a game state frame the client contract does not model:",
        issues.map((issue) => `${issue.path.join(".") || "<root>"} (${issue.code})`).join(", "),
      );
    };

    const receive = (value: WireValue) => {
      const incoming = clientViewSchema.safeParse(value).data;

      if (!incoming) reportRejectedView(value);

      if (leaving.current || !incoming || (terminalReceived.current && incoming.status !== "ended"))
        return;

      if (incoming.status === "ended") terminalReceived.current = true;
      selfIdRef.current = incoming.you?.playerId ?? selfIdRef.current;
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

      if (message.type === "chat_message") {
        const entry = chatEntrySchema.safeParse(payload).data;

        if (entry) {
          setChatEntries((current) =>
            current.some((line) => line.seq === entry.seq)
              ? current
              : [...current, entry].sort((a, b) => a.seq - b.seq),
          );

          if (!chatOpenRef.current && entry.senderPlayerId !== selfIdRef.current)
            setChatUnread((count) => count + 1);
        }
      }

      if (message.type === "chat_history") {
        const page = chatPageSchema.safeParse(payload).data;

        // Connect snapshots and cursor pages merge the same way: unique by
        // sequence, oldest first. A reconnect therefore never duplicates a line.
        if (page) {
          setChatEntries((current) => mergeChat(current, page, "append"));

          if (page.policy) setChatPolicy(page.policy);
        }
      }

      if (message.type === "chat_error") {
        const code = isString(payload.code) ? payload.code : "";

        setChatError(
          code === "CHAT_RATE_LIMITED"
            ? t("chat.rateLimited")
            : code === "CHAT_TOO_LONG"
              ? t("chat.tooLong")
              : code === "CHAT_SPECTATORS_MUTED"
                ? t("chat.muted")
                : t("chat.failed"),
        );
      }

      if (message.type === "error") {
        const code = isString(payload.code) ? payload.code : null;
        const known = code && isRoomErrorCode(code) ? code : null;

        const serverMessage = isString(payload.message)
          ? payload.message
          : isString(payload.error)
            ? payload.error
            : null;

        // The server authors `message` in English, so English readers keep its
        // exact wording — a coarse code would only make it vaguer. Chinese
        // readers get the code's copy, which is sometimes broader than the
        // server sentence but always readable.
        const text =
          locale === "en" && serverMessage
            ? serverMessage
            : known
              ? t(ERROR_MESSAGE_KEYS[known])
              : (serverMessage ?? t("room.actionRejected"));

        // Contexto already marks a word that is not in the pool next to the
        // input, so the duplicate toast is skipped by code, not by wording.
        if (known !== "CONTEXTO_WORD_NOT_IN_DICTIONARY") setError(text);
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

    const timers = { gameTotalTime: chosenMinutes * 60000, turnTime: seconds * 1000 };

    // Only a game that declares options sends them, so a game that declares
    // none never sees an unexpected key.
    const created =
      optionSpecs.length > 0
        ? createGameRoom({ gameType, ...timers, options: optionValues })
        : createGameRoom({ gameType, ...timers });

    try {
      acceptRoom(
        create ? await created : await joinGameRoom({ roomCode: code.trim().toUpperCase() }),
      );
    } catch (e) {
      setError(errorText(e, t("room.connectFailed")));
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
      setError(t("room.waitReconnect"));

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
      setError(t("room.copyInviteFailed"));
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
      setError(t("room.copyCodeFailed"));
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
                ? t("room.sessionExpired")
                : !authenticated
                  ? t("room.checkingAccount")
                  : connectionSlow
                    ? t("room.stillConnecting")
                    : t("room.connecting")
            }
          >
            {error && (
              <p role="alert" className="room-error">
                {error}
              </p>
            )}
            {room && authExpired && (
              <>
                <p className="room-loading-note">{t("room.placeSaved")}</p>
                <a className={buttonVariants({})} href={signInHref()}>
                  {t("room.signInAgain")}
                </a>
              </>
            )}
            {room && connectionSlow && !authExpired && (
              <>
                <p className="room-loading-note">{t("room.slowConnection")}</p>
                <Button variant="secondary" onClick={retryConnection}>
                  {t("common.retry")}
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
                  {t("common.playerCount", { count: game.players })}
                  <span aria-hidden="true"> · </span>
                  {gameText("category", game.category)}
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
                {gameText("title", game.title)}
              </h1>
              <p
                className="room-entry-lead reveal"
                style={
                  { "--i": 2 } satisfies CSSProperties & {
                    [property: `--${string}`]: string | number | undefined;
                  }
                }
              >
                {gameText("detail", game.detail)}
              </p>
            </header>
            <section
              className="room-entry-settings reveal"
              style={
                { "--i": 3 } satisfies CSSProperties & {
                  [property: `--${string}`]: string | number | undefined;
                }
              }
              aria-label={t("room.settings")}
            >
              {error && (
                <p role="alert" className="room-error">
                  {error}
                </p>
              )}
              {!demo && !isGameEnabled(gameType) ? (
                <div role="status" className="room-unavailable">
                  <p>{t("room.unavailable")}</p>
                  <ButtonLink href="/play" variant="secondary">
                    {t("room.browseGames")}
                  </ButtonLink>
                </div>
              ) : !authenticated ? (
                error ? (
                  <p role="status">
                    <Button onClick={() => location.reload()}>{t("room.retryAccount")}</Button>
                  </p>
                ) : (
                  <HoleyLoader label={t("room.checkingAccount")} />
                )
              ) : room ? (
                <div className="room-connection">
                  <HoleyLoader
                    label={connectionSlow ? t("room.stillConnecting") : t("room.connecting")}
                  />
                  {connectionSlow && (
                    <>
                      <p>{t("room.slowConnection")}</p>
                      <div className="room-connection-actions">
                        <Button variant="secondary" onClick={retryConnection}>
                          {t("common.retry")}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <form
                    className="room-create-form"
                    aria-label={t("room.createForm")}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void enter(true);
                    }}
                  >
                    <Choices
                      legend={t("room.matchLength")}
                      name="minutes"
                      values={minuteChoices}
                      value={chosenMinutes}
                      suffix={t("room.minuteSuffix")}
                      onChange={setMinutes}
                    />
                    {gameType !== "contexto" && (
                      <Choices
                        legend={t("room.timePerTurn")}
                        name="seconds"
                        values={[30, 60, 90, 120, 150]}
                        value={seconds}
                        suffix={t("room.secondSuffix")}
                        onChange={setSeconds}
                      />
                    )}
                    {optionSpecs.map((spec) => (
                      <Choices
                        key={spec.key}
                        legend={optionTitle(t, spec)}
                        name={`option-${spec.key}`}
                        values={spec.choices.map((choice) => choice.value)}
                        value={optionValues[spec.key] ?? spec.default}
                        format={(value) => optionChoiceLabel(t, spec, value)}
                        onChange={(value) =>
                          setOptionValues((current) => ({ ...current, [spec.key]: value }))
                        }
                      />
                    ))}
                    <div className="room-create-action">
                      <Button
                        type="submit"
                        size="lg"
                        className="room-create-button"
                        disabled={busy}
                        aria-busy={busy && entryAction === "create"}
                      >
                        {busy && entryAction === "create" ? t("room.creating") : t("room.create")}
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
                          "gomoku",
                        ].includes(gameType)
                          ? t("room.createHelpOpponent")
                          : t("room.createHelpTeam")}
                      </p>
                    </div>
                  </form>
                  <form
                    className="room-join-form"
                    aria-label={t("room.joinForm")}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void enter(false);
                    }}
                  >
                    <label htmlFor="game-room-code">{t("room.haveCode")}</label>
                    <div className="room-join-controls">
                      <Input
                        id="game-room-code"
                        disabled={busy}
                        aria-label={t("room.roomCode")}
                        placeholder={t("room.roomCodePlaceholder")}
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
                        {busy && entryAction === "join" ? t("room.joining") : t("room.join")}
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
              <h2 id="room-instructions-title">{t("room.howToPlay")}</h2>
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
                {(state.pausedBots?.length ?? 0) > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => send("resume_rule_bot", {})}>
                    {t("match.resumeBot")}
                  </Button>
                )}
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
                  {frame === null ? t("room.watchReplay") : t("room.backToResult")}
                </Button>
                {frame !== null && (
                  <label>
                    Move {frame + 1} of {replay.frames.length}
                    <input
                      aria-label={t("room.replayPosition")}
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
                  <span>{t("room.sessionExpired")}.</span>
                  <a className={buttonVariants({ size: "sm" })} href={signInHref()}>
                    {t("room.signInAgain")}
                  </a>
                </>
              ) : (
                <>
                  <HoleyLoader compact showLabel label={t("room.reconnecting")} size={22} />
                  {connectionSlow && (
                    <Button size="sm" variant="secondary" onClick={retryConnection}>
                      {t("common.retry")}
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
      {!demo && (
        <RoomChat
          open={chatOpen}
          onOpenChange={(next) => {
            setChatOpen(next);

            if (!next) return;
            setChatUnread(0);
            // Catch up on whatever arrived while the panel was closed.
            socket.current?.fetchChat(chatEntries.at(-1)?.seq);
          }}
          entries={chatEntries}
          members={[...(state.players ?? []), ...(state.spectators ?? [])]}
          me={{ playerId: state.you?.playerId, isSpectator: state.you?.isSpectator }}
          unread={chatUnread}
          connected={connected}
          readOnly={Boolean(state.replayReadOnly) || frame !== null}
          muted={!chatPolicy.spectatorSpeech}
          error={chatError}
          onSend={(text, mentions) => {
            setChatError("");
            socket.current?.sendChat(text, mentions);
          }}
        />
      )}
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
          <DialogTitle>{end ? t("room.endQuestion") : t("room.leaveQuestion")}</DialogTitle>
          <DialogDescription>
            {end
              ? t("room.endExplanation")
              : t("room.leaveExplanation")}
          </DialogDescription>
          <DialogFooter>
            <DialogClose className={buttonVariants({ variant: "secondary" })}>
              {t("room.keepPlaying")}
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                if (end) {
                  if (send("end_game")) setEnd(false);
                } else leave();
              }}
            >
              {end ? t("room.endGame") : t("room.leaveGame")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
