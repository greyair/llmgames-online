import { createContext, useContext } from "react";
import type { ClientView } from "@/domain/game-state";
import {
  isAgentIdentity,
  playerIdentityDetail,
  playerPrimaryName,
  type PlayerIdentity,
} from "@/features/shared/playerIdentity";
import "./player-name.css";
import { useT } from "@/i18n";

export const JevStatusContext = createContext<{
  playerId: string;
  status: NonNullable<ClientView["jev"]>["status"];
} | null>(null);

export function PlayerName({
  player,
  fallback,
  extra,
  className,
}: {
  player: PlayerIdentity & { id?: string };
  fallback?: string;
  extra?: string;
  className?: string;
}) {
  const t = useT();
  const detail = playerIdentityDetail(player);
  const jev = useContext(JevStatusContext);
  const status = jev && player.id === jev.playerId ? jev.status : null;

  const note =
    status === "retrying"
      ? t("match.jevReconnecting")
      : status === "limit_reached"
        ? t("match.jevLimitReached")
        : status === "unavailable"
          ? t("match.jevNoMove")
          : null;

  return (
    <span
      className={["player-name-label", className].filter(Boolean).join(" ")}
      data-kind={isAgentIdentity(player) ? "agent" : "human"}
      data-jev-status={status ?? undefined}
    >
      <strong>{playerPrimaryName(player, fallback)}</strong>
      {detail && <small className="player-name-detail">{detail}</small>}
      {extra && <small>{extra}</small>}
      {note && (
        <small className="jev-name-note" role="status">
          {note}
        </small>
      )}
    </span>
  );
}
