import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { RoomChatEntry } from "@/domain/chat";
import { CHAT_MAX_TEXT } from "@/domain/chat";
import { playerPrimaryName } from "@/features/shared/playerIdentity";
import type { GamePlayer } from "@/features/shared/gameOverCopy";
import "./room-chat.css";

/**
 * Public room chat (C1).
 *
 * One conversation for humans, MCP agents and rule bots: everything here is
 * what the server broadcast, so there is no local echo and no second log. The
 * panel lives beside the board rather than inside it, which keeps the playable
 * area the same size it was before chat existed.
 */

type Member = GamePlayer & { isAgent?: boolean; bot?: boolean };

/**
 * The chat entry point.
 *
 * It belongs in the match bar, not floating over the board: the old fixed pill
 * landed on the team roster at common widths and read as part of the game
 * instead of a control. The bar is always visible, so the entry cannot be
 * covered by a board, a dock or a card row.
 */
export function RoomChatButton({
  open,
  unread,
  onOpenChange,
}: {
  open: boolean;
  unread: number;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();

  return (
    <Button
      className="room-chat-toggle"
      variant={open ? "secondary" : "ghost"}
      size="icon"
      aria-expanded={open}
      aria-controls="room-chat-panel"
      aria-label={open ? t("chat.close") : t("chat.openChat")}
      onClick={() => onOpenChange(!open)}
    >
      <Icon name="chat" size={20} />
      {!open && unread > 0 && (
        <span className="room-chat-badge" aria-label={t("chat.newMessages", { count: unread })}>
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Button>
  );
}

export function RoomChat({
  open,
  onOpenChange,
  entries,
  members,
  me,
  connected,
  readOnly,
  muted,
  error,
  onSend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: readonly RoomChatEntry[];
  members: readonly Member[];
  me: { playerId?: string; isSpectator?: boolean };
  connected: boolean;
  /** Replay frames and watched broadcasts cannot speak. */
  readOnly: boolean;
  /** The host closed the room to spectator speech. */
  muted: boolean;
  error: string;
  onSend: (text: string, mentions: string[]) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const log = useRef<HTMLOListElement>(null);
  const follow = useRef(true);

  const others = useMemo(
    () => members.filter((member) => member.id !== me.playerId),
    [members, me.playerId],
  );

  // Stick to the newest line only while the reader is already at the bottom;
  // otherwise a message that arrives mid-scroll would jump the view away.
  useEffect(() => {
    const node = log.current;

    if (!node || !open || !follow.current) return;
    node.scrollTop = node.scrollHeight;
  }, [entries, open]);

  useEffect(() => {
    if (open) setPicking(false);
  }, [open]);

  const canSpeak = connected && !readOnly && !(muted && me.isSpectator);

  function submit() {
    const text = draft.trim();

    if (!text || !canSpeak) return;

    if ([...text].length > CHAT_MAX_TEXT) return;

    onSend(text, mentions);
    setDraft("");
    setMentions([]);
    follow.current = true;
  }

  function mention(member: Member) {
    setMentions((current) =>
      current.includes(member.id) ? current : [...current, member.id].slice(0, 8),
    );
    setDraft((current) => {
      const name = playerPrimaryName(member);

      return current ? `${current} @${name} ` : `@${name} `;
    });
    setPicking(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();

      return;
    }

    if (event.key === "Escape") {
      if (picking) setPicking(false);
      else onOpenChange(false);
    }
  }

  return (
    <>
      <aside
        id="room-chat-panel"
        className="room-chat"
        data-open={open || undefined}
        aria-label={t("chat.title")}
        aria-hidden={!open}
        onPointerEnter={() => {
          follow.current =
            (log.current?.scrollHeight ?? 0) - (log.current?.scrollTop ?? 0) -
              (log.current?.clientHeight ?? 0) <
            48;
        }}
      >
        <header className="room-chat-head">
          <h2>{t("chat.title")}</h2>
          <span className="room-chat-count">{entries.length}</span>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t("chat.close")}
            onClick={() => onOpenChange(false)}
          >
            <Icon name="close" size={18} />
          </Button>
        </header>
        <ol
          className="room-chat-log"
          ref={log}
          aria-label={t("chat.listLabel")}
          aria-live="polite"
          aria-relevant="additions"
          onScroll={(event) => {
            const node = event.currentTarget;

            follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
          }}
        >
          {entries.length === 0 ? (
            <li className="room-chat-empty">{t("chat.empty")}</li>
          ) : (
            entries.map((entry) => (
              <li
                key={entry.seq}
                className="room-chat-line"
                data-self={entry.senderPlayerId === me.playerId || undefined}
                data-kind={entry.author.seatKind}
                data-mentions-me={
                  me.playerId && entry.mentions.includes(me.playerId) ? true : undefined
                }
              >
                <span className="room-chat-meta">
                  <strong>{entry.author.displayName}</strong>
                  {entry.author.isHost && <span className="room-chat-tag">{t("chat.host")}</span>}
                  {entry.author.seatKind === "bot" && (
                    <span className="room-chat-tag">{t("chat.bot")}</span>
                  )}
                  {entry.author.seatKind === "mcp" && (
                    <span className="room-chat-tag">{entry.author.environmentLabel ?? "MCP"}</span>
                  )}
                  {entry.senderPlayerId === me.playerId && (
                    <span className="room-chat-tag">{t("chat.you")}</span>
                  )}
                </span>
                {/* Rendered as text, never as markup: the server never sends HTML. */}
                <span className="room-chat-text">{entry.text}</span>
              </li>
            ))
          )}
        </ol>
        {muted && me.isSpectator && <p className="room-chat-note">{t("chat.muted")}</p>}
        {me.isSpectator && !muted && <p className="room-chat-note">{t("chat.spectatorNote")}</p>}
        {error && (
          <p className="room-chat-error" role="alert">
            {error}
          </p>
        )}
        <form
          className="room-chat-compose"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {mentions.length > 0 && (
            <ul className="room-chat-mentions" aria-label={t("chat.mentionTitle")}>
              {mentions.map((id) => {
                const member = members.find((entry) => entry.id === id);

                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => setMentions((current) => current.filter((x) => x !== id))}
                      aria-label={t("chat.mention", {
                        name: member ? playerPrimaryName(member) : id,
                      })}
                    >
                      @{member ? playerPrimaryName(member) : id}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="room-chat-row">
            <textarea
              className="room-chat-input"
              rows={1}
              value={draft}
              maxLength={CHAT_MAX_TEXT}
              disabled={!canSpeak}
              placeholder={t("chat.placeholder")}
              aria-label={t("chat.placeholder")}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t("chat.mentionTitle")}
              aria-expanded={picking}
              disabled={!canSpeak || others.length === 0}
              onClick={() => setPicking(!picking)}
            >
              @
            </Button>
            <Button type="submit" size="sm" disabled={!canSpeak || !draft.trim()}>
              {t("chat.send")}
            </Button>
          </div>
          {picking && (
            <ul className="room-chat-picker" aria-label={t("chat.mentionTitle")}>
              {others.map((member) => (
                <li key={member.id}>
                  <button type="button" onClick={() => mention(member)}>
                    {playerPrimaryName(member)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
      </aside>
    </>
  );
}
