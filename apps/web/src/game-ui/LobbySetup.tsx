import { z } from "zod";

const zoneSchema = z.enum([
  "players",
  "spectators",
  "blue:spymaster",
  "blue:operative",
  "red:spymaster",
  "red:operative",
]);

import type { WireValue } from "@llmgames/game-catalog";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { play } from "@/lib/sound";
import type { ClientView } from "@/domain/game-state";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { GamePlayerAvatar, JevLogo } from "./GamePlayerAvatar";
import { playerPrimaryName } from "@/features/shared/playerIdentity";
import { PlayerName } from "./PlayerName";
import { AgentWebhookInvites } from "./AgentWebhookInvites";
import "./lobby.css";

type Member = NonNullable<ClientView["players"]>[number];

type Zone =
  | "players"
  | "spectators"
  | "blue:spymaster"
  | "blue:operative"
  | "red:spymaster"
  | "red:operative";

type JevAccess = { connected: boolean; trialAvailable: boolean };

const roleZones: Zone[] = ["blue:spymaster", "blue:operative", "red:spymaster", "red:operative"];

const zoneLabel = (zone: Zone) =>
  zone === "players"
    ? "Players"
    : zone === "spectators"
      ? "Spectators"
      : `${zone.startsWith("blue") ? "Blue" : "Red"} ${zone.endsWith("spymaster") ? "spymaster" : "operatives"}`;

export function LobbySetup({
  state,
  connected,
  error,
  send,
  onClose,
  onCopyCode,
  onCopyInvite,
  codeCopied,
  inviteCopied,
}: {
  state: ClientView;
  connected: boolean;
  error?: string;
  send: (action: string, data?: WireValue) => boolean | void;
  onClose: () => void;
  onCopyCode: () => void;
  onCopyInvite: () => void;
  codeCopied: boolean;
  inviteCopied: boolean;
}) {
  const teams = state.type === "codenames";

  const players = state.players ?? [],
    spectators = state.spectators ?? [],
    members = [...players, ...spectators];

  const assignments = state.assignments ?? {};

  const host = Boolean(state.you?.isHost),
    me = state.you?.playerId;

  const maximum = state.maxPlayers ?? (teams ? 8 : state.type === "poker" ? 6 : 2);
  const minimum = teams ? 4 : ["contexto"].includes(state.type ?? "") ? 1 : 2;

  const [selected, setSelected] = useState<string | null>(null),
    [revealed, setRevealed] = useState(false);

  const [drag, setDrag] = useState<{ id: string; x: number; y: number; zone: Zone | null } | null>(
    null,
  );

  const [pending, setPending] = useState<{ snapshot: string; error?: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [jevAccess, setJevAccess] = useState<JevAccess | null>(null);
  const gesture = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const pointer = useRef({ x: 0, y: 0 });
  const dragging = Boolean(drag);
  useEffect(() => {
    if (!dragging) return;
    let frame = 0;

    const scroll = () => {
      const container = document.querySelector<HTMLElement>(
        ".match-desk[data-phase=waiting] .desk-layout",
      );

      if (container) {
        const bounds = container.getBoundingClientRect(),
          y = pointer.current.y;

        const delta =
          y < bounds.top + 65 ? -12 : y > Math.min(bounds.bottom, innerHeight) - 65 ? 12 : 0;

        if (delta) container.scrollBy(0, delta);
      }

      frame = requestAnimationFrame(scroll);
    };

    frame = requestAnimationFrame(scroll);

    return () => cancelAnimationFrame(frame);
  }, [dragging]);

  const snapshot = JSON.stringify([
    players.map((p) => p.id),
    spectators.map((p) => p.id),
    assignments,
    state.hostId,
  ]);

  const memberKey = members.map((p) => p.id).join("|");
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = memberKey ? memberKey.split("|") : [];
    const previous = seen.current;
    seen.current = new Set(ids);

    if (previous && ids.some((id) => !previous.has(id))) play("join");
  }, [memberKey]);
  const waiting = Boolean(pending && pending.snapshot === snapshot && pending.error === error);
  const allowed = connected && state.status === "waiting" && !state.replayReadOnly && !waiting;
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(null), 5000);

    return () => clearTimeout(timer);
  }, [pending]);
  useEffect(() => {
    if (!host || !state.jev?.available || state.jev.playerId) return;
    let active = true;
    fetch("/api/v1/auth/users/me/typesafe", { credentials: "include", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();

        return response.json();
      })
      .then((access) => {
        if (active) setJevAccess(access);
      })
      .catch(() => {
        if (active) setJevAccess({ connected: false, trialAvailable: false });
      });

    return () => {
      active = false;
    };
  }, [host, state.jev?.available, state.jev?.playerId]);

  const currentZone = (id: string): Zone =>
    !players.some((p) => p.id === id)
      ? "spectators"
      : teams && assignments[id]
        ? `${assignments[id].team}:${assignments[id].role}`
        : "players";

  function canMove(id: string, zone: Zone) {
    if (!allowed || !members.some((p) => p.id === id) || currentZone(id) === zone) return false;

    if (!host && (!teams || id !== me || zone === "spectators")) return false;

    if (zone !== "spectators" && currentZone(id) === "spectators" && players.length >= maximum)
      return false;

    if (
      !host &&
      zone.endsWith("spymaster") &&
      players.some((p) => p.id !== id && currentZone(p.id) === zone)
    )
      return false;

    return true;
  }

  function request(action: string, data?: WireValue) {
    if (!allowed) return;
    setNotice("");

    if (send(action, data) !== false) {
      setPending({ snapshot, error });
      setSelected(null);
    }
  }

  function move(id: string, zone: Zone) {
    if (!canMove(id, zone)) {
      setNotice(
        zone !== "spectators" && currentZone(id) === "spectators" && players.length >= maximum
          ? "All player seats are taken. Move a player to spectators first."
          : "That move is not available.",
      );

      return;
    }

    if (zone === "spectators") request("move_player_to_spectator", { playerId: id });
    else if (roleZones.includes(zone)) {
      const [team, role] = zone.split(":");
      request("assign_codenames_role", { playerId: id, team, role });
    } else if (currentZone(id) === "spectators")
      request("set_player_seats", { playerIds: [...players.map((p) => p.id), id] });
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (!allowed || (!host && (!teams || id !== me)) || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { id, x: event.clientX, y: event.clientY, moved: false };
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const active = gesture.current;

    if (!active) return;

    if (Math.hypot(event.clientX - active.x, event.clientY - active.y) < 6 && !active.moved) return;
    active.moved = true;
    pointer.current = { x: event.clientX, y: event.clientY };

    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-lobby-zone]");

    setDrag({
      id: active.id,
      x: event.clientX,
      y: event.clientY,
      zone: zoneSchema.safeParse(target?.dataset.lobbyZone).data ?? null,
    });
  }

  function pointerUp(event: PointerEvent<HTMLButtonElement>) {
    const active = gesture.current;
    gesture.current = null;
    setDrag(null);

    if (!active?.moved) return;
    suppressClick.current = true;
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);

    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-lobby-zone]");

    const zone = zoneSchema.safeParse(target?.dataset.lobbyZone).data;

    if (zone) move(active.id, zone);
  }

  function card(member: Member) {
    const editable = allowed && (host || (teams && member.id === me));
    const isHost = member.id === state.hostId || (member.id === me && host);

    return (
      <motion.button
        key={member.id}
        layout="position"
        initial={{ opacity: 0, scale: 0.82, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ type: "spring", stiffness: 520, damping: 32 }}
        type="button"
        className="lobby-member"
        data-self={member.id === me}
        data-agent={Boolean(member.isAgent) || undefined}
        data-selected={selected === member.id}
        data-dragging={drag?.id === member.id}
        disabled={!editable}
        aria-label={`Move ${playerPrimaryName(member)}`}
        aria-pressed={selected === member.id}
        onPointerDown={(event) => pointerDown(event, member.id)}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={() => {
          gesture.current = null;
          setDrag(null);
        }}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;

            return;
          }

          setSelected(selected === member.id ? null : member.id);
          setNotice("");
        }}
      >
        <span className="lobby-member-avatar">
          <GamePlayerAvatar player={member} size={40} />
        </span>
        <PlayerName className="lobby-member-name" player={member} />
        <span className="lobby-tags">
          {isHost && <span className="lobby-tag">Host</span>}
          {member.id === me && <span className="lobby-tag lobby-you">You</span>}
        </span>
        <span className="lobby-grip" aria-hidden="true">
          <Icon name="grip" size={18} />
        </span>
      </motion.button>
    );
  }

  function zone(id: Zone) {
    const occupants = members.filter((member) => currentZone(member.id) === id);
    const picked = selected ? members.find((p) => p.id === selected) : undefined;
    const destination = drag?.zone === id;
    const candidate = picked?.id ?? me;
    const possible = Boolean(candidate && canMove(candidate, id));
    const isRole = roleZones.includes(id);

    const showDestination = Boolean(
      picked || isRole || (host && id === "players" && me && currentZone(me) !== "players"),
    );

    const openSeats = id === "players" ? Math.max(0, Math.min(maximum, 8) - occupants.length) : 0;

    return (
      <section
        key={id}
        className="lobby-zone"
        data-lobby-zone={id}
        data-kind={isRole ? "role" : id}
        data-team={id.split(":")[0]}
        data-over={destination}
        data-valid={destination && drag ? canMove(drag.id, id) : undefined}
        aria-label={zoneLabel(id)}
      >
        <header>
          <h3>
            {id === "spectators" ? (
              <Icon name="watch" size={16} />
            ) : (
              <Icon name="players" size={16} />
            )}{" "}
            {isRole ? (id.endsWith("spymaster") ? "Spymaster" : "Operatives") : zoneLabel(id)}
          </h3>
          <span>
            {occupants.length}
            {id.endsWith("spymaster") ? "/1" : id === "players" ? `/${maximum}` : ""}
          </span>
        </header>
        <div className="lobby-zone-members">
          <AnimatePresence initial={false} mode="popLayout">
            {occupants.map(card)}
          </AnimatePresence>
          {Array.from({ length: openSeats }, (_, i) => (
            <span key={`open-${i}`} className="lobby-open-seat" aria-hidden="true">
              <span />
              Open seat
            </span>
          ))}
          {!occupants.length && !openSeats && (
            <p className="lobby-empty">
              {id === "spectators" ? "Drop a player here to watch." : "Drop a player here."}
            </p>
          )}
        </div>
        {showDestination && (
          <Button
            className="lobby-drop-action"
            size="sm"
            variant="secondary"
            disabled={!possible}
            onClick={() => candidate && move(candidate, id)}
          >
            {picked
              ? "Move here"
              : isRole && me && currentZone(me) === id
                ? "Your role"
                : isRole
                  ? "Join role"
                  : "Take a seat"}
          </Button>
        )}
      </section>
    );
  }

  const unassigned = teams && players.some((p) => !assignments[p.id]);

  const completeTeams =
    !teams ||
    ["red", "blue"].every(
      (team) =>
        players.some(
          (p) => assignments[p.id]?.team === team && assignments[p.id]?.role === "spymaster",
        ) &&
        players.some(
          (p) => assignments[p.id]?.team === team && assignments[p.id]?.role === "operative",
        ),
    );

  const ready =
    players.length >= minimum && players.length <= maximum && !unassigned && completeTeams;

  const reason =
    players.length < minimum
      ? `${minimum - players.length} more ${minimum - players.length === 1 ? "player" : "players"} needed to start.`
      : !completeTeams
        ? "Each team needs a spymaster and an operative."
        : unassigned
          ? "Syncing player roles…"
          : "Everyone is seated. Ready when you are.";

  const jevCanAdd = Boolean(jevAccess && (jevAccess.connected || jevAccess.trialAvailable));
  const jevAddLabel = jevAccess?.connected ? "Add Jev" : "Try Jev for a game";
  const dragMember = drag ? (members.find((p) => p.id === drag.id) ?? { id: drag.id }) : undefined;

  return (
    <div
      className="lobby-setup"
      data-teams={teams || undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setSelected(null);
          setDrag(null);
          gesture.current = null;
        }
      }}
    >
      <header className="lobby-heading">
        <div>
          <h2>Set up your table</h2>
        </div>
        <span className="lobby-count" data-full={players.length >= maximum || undefined}>
          {players.length} / {maximum} players
        </span>
      </header>
      <div className="lobby-invite" data-surface="dark">
        <div className="lobby-code-row">
          <div className="lobby-code">
            <span className="lobby-code-label" aria-hidden="true">
              Room code
            </span>
            <strong
              aria-label={revealed ? `Room code ${state.roomCode}` : "Room code hidden"}
              data-revealed={revealed}
            >
              {revealed ? state.roomCode : "••••••"}
            </strong>
          </div>
          <Button
            className="lobby-code-toggle"
            size="icon"
            variant="secondary"
            aria-label={revealed ? "Hide room code" : "Show room code"}
            aria-pressed={revealed}
            onClick={() => setRevealed(!revealed)}
          >
            <Icon name="watch" size={18} />
          </Button>
        </div>
        <div className="lobby-invite-actions">
          <Button className="lobby-copy-code" size="sm" variant="secondary" onClick={onCopyCode}>
            {codeCopied ? <Icon name="check" size={16} /> : <Icon name="copy" size={18} />}
            {codeCopied ? "Code copied" : "Copy code"}
          </Button>
          <Button className="lobby-copy-invite" size="sm" onClick={onCopyInvite}>
            {inviteCopied ? <Icon name="check" size={16} /> : <Icon name="link" size={18} />}
            {inviteCopied ? "Link copied" : "Copy invite"}
          </Button>
        </div>
      </div>
      {host && state.jev?.available && (
        <div className="lobby-jev">
          <div>
            <strong>
              <JevLogo size={22} /> Play with Jev
            </strong>
            <p>
              {state.jev.playerId
                ? "Jev is at your table. One Jev player per room."
                : !jevAccess
                  ? "Checking Jev access…"
                  : jevAccess.connected
                    ? "Jev will use your connected TypeSafe account."
                    : jevAccess.trialAvailable
                      ? "Try one game free. If you connect TypeSafe, Jev uses your account instead."
                      : "Your free Jev game has been used. Connect TypeSafe to keep playing."}
            </p>
          </div>
          <div className="lobby-jev-actions">
            {state.jev.playerId ? (
              <Button
                size="sm"
                variant="secondary"
                aria-label="Remove Jev"
                disabled={!allowed}
                onClick={() => request("remove_jev")}
              >
                Remove Jev
              </Button>
            ) : jevCanAdd ? (
              <Button
                size="sm"
                aria-label={jevAddLabel}
                disabled={!allowed || players.length >= maximum}
                onClick={() => request("add_jev")}
              >
                <JevLogo size={18} /> {jevAddLabel}
              </Button>
            ) : null}
            {!state.jev.playerId && !jevAccess?.connected && (
              <ButtonLink
                size="sm"
                variant="ghost"
                href="/profile#jev-settings"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Connect your account, opens Profile in a new tab"
              >
                Connect your account <Icon name="arrowUpRight" size={18} />
              </ButtonLink>
            )}
          </div>
        </div>
      )}
      {host && state.roomCode && (
        <AgentWebhookInvites
          key={state.roomCode}
          roomCode={state.roomCode}
          allowed={allowed && players.length < maximum}
        />
      )}
      {(selected || (teams && host)) && (
        <div className="lobby-help">
          {selected && (
            <>
              <p>
                {playerPrimaryName(members.find((p) => p.id === selected) ?? { id: selected })}:
                choose a destination below.
              </p>
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                Cancel move
              </Button>
            </>
          )}
          {teams && host && (
            <div>
              <Button
                size="sm"
                variant="secondary"
                disabled={!allowed || players.length < 4 || players.length > 8}
                onClick={() => request("randomize_codenames_roles")}
              >
                <Icon name="shuffle" size={18} />
                Shuffle teams
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!allowed || !Object.keys(assignments).length}
                onClick={() => request("reset_codenames_roles")}
              >
                Reset teams
              </Button>
            </div>
          )}
        </div>
      )}
      {teams ? (
        <div className="lobby-team-columns">
          {(["blue", "red"] as const).map((team) => (
            <div key={team} className="lobby-team" data-team={team}>
              <h3>{team === "blue" ? "Blue team" : "Red team"}</h3>
              {zone(`${team}:spymaster`)}
              {zone(`${team}:operative`)}
            </div>
          ))}
        </div>
      ) : (
        <div className="lobby-zones">{zone("players")}</div>
      )}
      <details
        className="lobby-settings"
        open={selected !== null || drag !== null || undefined}
        onToggle={(event) => {
          const details = event.currentTarget;

          if (details.open && !gesture.current) details.scrollIntoView({ block: "nearest" });
        }}
      >
        <summary>
          <span>Room settings · {spectators.length} spectators</span>
          <Icon name="chevronDown" className="lobby-settings-caret" size={18} />
        </summary>
        <div className="lobby-spectators">{zone("spectators")}</div>
        <div className="lobby-timing">
          <span>
            Match length
            <strong>{Math.round((state.timerConfig?.gameTotalTime ?? 1800000) / 60000)}m</strong>
          </span>
          <span>
            Time per turn
            <strong>{Math.round((state.timerConfig?.turnTime ?? 30000) / 1000)}s</strong>
          </span>
          {state.type === "battleship" && (
            <span>
              Fleet placement<strong>5m</strong>
            </span>
          )}
        </div>
      </details>
      <div className="lobby-start">
        <p
          className="lobby-status"
          role="status"
          data-ready={(ready && connected && !waiting && !notice) || undefined}
        >
          {!connected
            ? "Reconnecting. Seat changes are paused."
            : waiting
              ? "Updating the room…"
              : notice || reason}
        </p>
        {host && (
          <footer className="lobby-footer">
            <Button variant="ghost" onClick={onClose}>
              Close room
            </Button>
            <Button
              className="lobby-start-button"
              size="lg"
              disabled={!allowed || !ready}
              onClick={() => {
                play("start");
                request("start_game");
              }}
            >
              Start game <Icon name="play" size={16} />
            </Button>
          </footer>
        )}
      </div>
      <AnimatePresence>
        {drag && dragMember && (
          <motion.div
            key="drag"
            className="lobby-drag-card"
            style={{ left: drag.x + 14, top: drag.y + 14 }}
            initial={{ opacity: 0, scale: 0.8, rotate: -6 }}
            animate={{ opacity: 1, scale: 1, rotate: -3 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: "spring", stiffness: 600, damping: 30 }}
            aria-hidden="true"
          >
            <GamePlayerAvatar player={dragMember} size={24} />
            {playerPrimaryName(dragMember)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
