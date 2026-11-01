import { createContext } from "react";
import { useT } from "@/i18n";
import { PlayerAvatar } from "@/components/ui/player-avatar";
import { isAgentIdentity, playerPrimaryName } from "@/features/shared/playerIdentity";
import type { GamePlayer } from "@/features/shared/gameOverCopy";
import typeSafeLogo from "@/assets/typesafe-logo.svg?url";
import "./player-name.css";

export function JevLogo({ size = 28 }: { size?: number }) {
  const t = useT();

  return (
    <img
      className="jev-logo"
      src={typeSafeLogo}
      alt={t("match.jevLogo")}
      width={size}
      height={size}
      style={{ width: size, height: size }}
    />
  );
}

export const GameAvatarContext = createContext<string[]>([]);

export function GamePlayerAvatar({ player, size = 28 }: { player: GamePlayer; size?: number }) {
  const agent = isAgentIdentity(player);

  if (
    agent &&
    player.environmentLabel === "TypeSafe" &&
    (player.codename === "Jev" || player.name === "Jev")
  )
    return <JevLogo size={size} />;
  const displayName = playerPrimaryName(player);

  // A rule bot gets its own avatar family so it never looks like a person or an
  // external agent in the room.
  const avatarName = player.bot
    ? `bot:${displayName}`
    : agent
      ? `agent:${player.codename?.trim() || displayName}`
      : `human:${displayName}`;

  return <PlayerAvatar name={avatarName} size={size} label={`${displayName} avatar`} />;
}
