import { useCallback, useEffect, useMemo, useState } from "react";
import { ENABLED_GAME_TYPES, gameOptionsFor } from "@llmgames/game-catalog";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GameBoard } from "@/game-ui/GameBoard";
import { optionChoiceLabel, optionTitle } from "@/game-ui/gameOptions";
import type { WireValue } from "@llmgames/game-catalog";
import { useT } from "@/i18n";
import { clientViewContract, clientViewSchema, type ClientView } from "@/domain/game-state";
import "./sandbox.css";

/**
 * Live Sandbox (C3).
 *
 * Not a re-implementation of any game: it creates a real room, then asks the
 * server for that seat's own projection and sends that seat's own intents.
 * The board is the same `GameBoard` the product ships, so a projection that
 * does not satisfy the browser contract fails here exactly as it would in a
 * real room — the panel names the offending field path instead of hiding it.
 *
 * The server decides whether this page works at all: `/api/v1/dev/sandbox/*`
 * answers 404 unless the deployment opted in, so the page cannot grant itself
 * the ability to act as another seat.
 */

const API = "/api/v1/dev/sandbox";

const roomSchema = z.object({
  roomId: z.string(),
  roomCode: z.string(),
  gameType: z.string(),
  seats: z.array(z.object({ id: z.string(), name: z.string() })),
});

const viewSchema = z.object({ state: z.unknown() });

const eventsSchema = z.object({
  events: z.array(z.object({ seq: z.number(), at: z.number(), type: z.string() })),
});

type SandboxRoom = z.output<typeof roomSchema>;

const SPECTATOR_ID = "sandbox-spectator";

const SEAT_COUNTS = [2, 3, 4, 5, 6];

const errorBodySchema = z.object({ error: z.string() });

/** Parse at the boundary: a route that fails must yield its own message. */
async function readJson(response: Response) {
  const body = await response.json().catch(() => null);

  if (!response.ok)
    throw new Error(
      errorBodySchema.safeParse(body).data?.error ?? `Request failed: ${response.status}`,
    );

  return body;
}

export function Sandbox() {
  const t = useT();

  /** Plain string: the catalog normalises it, so no cast is needed here. */
  const [gameType, setGameType] = useState("gomoku");
  const [seatCount, setSeatCount] = useState(2);
  const [optionValues, setOptionValues] = useState<Record<string, string>>({});
  const [room, setRoom] = useState<SandboxRoom | null>(null);
  const [seatId, setSeatId] = useState<string>("");
  const [state, setState] = useState<ClientView | null>(null);
  const [events, setEvents] = useState<Array<{ seq: number; type: string; at: number }>>([]);
  const [error, setError] = useState("");
  const [contractIssue, setContractIssue] = useState("");
  const [busy, setBusy] = useState(false);

  const optionSpecs = gameOptionsFor(gameType);

  const seats = useMemo(
    () => [...(room?.seats ?? []), { id: SPECTATOR_ID, name: t("dev.sandbox.spectator") }],
    [room, t],
  );

  const loadView = useCallback(
    async (current: SandboxRoom, playerId: string) => {
      const query = new URLSearchParams({ roomId: current.roomId, playerId });

      const incoming = viewSchema.parse(
        await readJson(await fetch(`${API}/view?${query.toString()}`)),
      ).state;

      // The M4 lesson: a frame the browser contract rejects must fail loudly,
      // and name the field path instead of leaving the page on a blank board.
      const contract = clientViewContract.safeParse(incoming);

      setContractIssue(
        contract.success
          ? ""
          : (contract.error.issues ?? [])
              .map((issue) => `${issue.path.join(".") || "<root>"} (${issue.code})`)
              .join(", "),
      );

      setState(clientViewSchema.safeParse(incoming).data ?? null);
    },
    [],
  );

  const loadEvents = useCallback(async (current: SandboxRoom) => {
    const body = eventsSchema.parse(
      await readJson(await fetch(`${API}/events?roomId=${current.roomId}`)),
    );

    setEvents(body.events);
  }, []);

  const refresh = useCallback(
    async (current: SandboxRoom, playerId: string) => {
      await loadView(current, playerId);
      await loadEvents(current);
    },
    [loadView, loadEvents],
  );

  useEffect(() => {
    if (!room || !seatId) return;

    void refresh(room, seatId).catch((cause: Error) => setError(cause.message));
  }, [room, seatId, refresh]);

  async function create(recreate: boolean) {
    setBusy(true);
    setError("");
    setContractIssue("");

    try {
      const request = {
        gameType,
        players: seatCount,
        options: optionSpecs.length > 0 ? optionValues : undefined,
      };

      const body = await readJson(
        await fetch(`${API}/rooms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        }),
      );

      const created = roomSchema.parse(body);

      setRoom(created);
      setSeatId(created.seats[0]?.id ?? "");
      setState(null);

      if (recreate) setEvents([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function act(actionType: string) {
    if (!room) return;

    setBusy(true);
    setError("");

    try {
      await fetch(`${API}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: room.roomId, playerId: seatId, actionType, data: {} }),
      }).then(readJson);

      await refresh(room, seatId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  /** Send one intent through the seat's own board, exactly as a player would. */
  function send(action: string, data?: WireValue) {
    if (!room) return;

    setBusy(true);

    void fetch(`${API}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomId: room.roomId,
        playerId: seatId,
        actionType: action,
        data: data ?? {},
      }),
    })
      .then(readJson)
      .then(() => refresh(room, seatId))
      .catch((cause: Error) => setError(cause.message))
      .finally(() => setBusy(false));
  }

  const current = state?.turnState?.currentPlayerId ?? null;
  const legal = state?.you?.legalActions ?? [];
  const isHost = seatId === room?.seats[0]?.id;

  return (
    <div className="sandbox">
      <header className="sandbox-head">
        <div>
          <h1>{t("dev.sandbox.title")}</h1>
          <p>{t("dev.sandbox.lead")}</p>
        </div>
        {room && (
          <p className="sandbox-room">
            {t("dev.sandbox.room")} <strong>{room.roomCode}</strong>
          </p>
        )}
      </header>

      <section className="sandbox-controls" aria-label={t("dev.sandbox.game")}>
        <label>
          {t("dev.sandbox.game")}
          <select
            value={gameType}
            onChange={(event) => {
              setGameType(event.target.value);
              setOptionValues({});
            }}
          >
            {ENABLED_GAME_TYPES.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("dev.sandbox.players")}
          <select value={seatCount} onChange={(event) => setSeatCount(Number(event.target.value))}>
            {SEAT_COUNTS.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </select>
        </label>
        {optionSpecs.map((spec) => (
          <label key={spec.key}>
            {optionTitle(t, spec)}
            <select
              value={optionValues[spec.key] ?? spec.default}
              onChange={(event) =>
                setOptionValues((values) => ({ ...values, [spec.key]: event.target.value }))
              }
            >
              {spec.choices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {optionChoiceLabel(t, spec, choice.value)}
                </option>
              ))}
            </select>
          </label>
        ))}
        <div className="sandbox-controls-actions">
          <Button disabled={busy} onClick={() => void create(false)}>
            {t("dev.sandbox.create")}
          </Button>
          <Button variant="secondary" disabled={busy || !room} onClick={() => void create(true)}>
            {t("dev.sandbox.recreate")}
          </Button>
          {room && isHost && state?.status === "waiting" && (
            <Button variant="secondary" disabled={busy} onClick={() => void act("start_game")}>
              {t("dev.sandbox.start")}
            </Button>
          )}
        </div>
      </section>

      {error && (
        <p className="sandbox-error" role="alert">
          {error}
        </p>
      )}
      {contractIssue && (
        <p className="sandbox-error" role="alert">
          {t("dev.sandbox.invalidView")} <code>{contractIssue}</code>
        </p>
      )}

      {!room ? (
        <p className="sandbox-empty">{t("dev.sandbox.empty")}</p>
      ) : (
        <div className="sandbox-body">
          <section className="sandbox-board" aria-label={t("dev.sandbox.game")}>
            {state ? <GameBoard state={state} send={send} /> : null}
          </section>

          <aside className="sandbox-side">
            <Card>
              <CardHeader>
                <CardTitle>{t("dev.sandbox.acting")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="sandbox-seats">
                  {seats.map((seat) => (
                    <li key={seat.id}>
                      <button
                        type="button"
                        aria-pressed={seat.id === seatId}
                        data-current={seat.id === current || undefined}
                        onClick={() => setSeatId(seat.id)}
                      >
                        {seat.name}
                      </button>
                    </li>
                  ))}
                </ul>
                <dl className="sandbox-facts">
                  <div>
                    <dt>{t("dev.sandbox.phase")}</dt>
                    <dd>{state?.turnState?.phase ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>{t("dev.sandbox.turn")}</dt>
                    <dd>{state?.turnState?.turnNumber ?? 0}</dd>
                  </div>
                  <div>
                    <dt>{t("dev.sandbox.legal")}</dt>
                    <dd>{legal.length > 0 ? legal.join(", ") : t("dev.sandbox.none")}</dd>
                  </div>
                  <div>
                    <dt>{t("dev.sandbox.history")}</dt>
                    <dd>{t("dev.sandbox.moved", { count: events.length })}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("dev.sandbox.history")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="sandbox-events">
                  {events
                    .slice(-12)
                    .reverse()
                    .map((event) => (
                      <li key={`${event.seq}-${event.type}`}>
                        <span>{event.seq}</span> {event.type}
                      </li>
                    ))}
                </ol>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("dev.sandbox.projection")}</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="sandbox-json">{JSON.stringify(state, null, 1)}</pre>
              </CardContent>
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}
