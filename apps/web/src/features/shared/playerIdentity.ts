export type PlayerIdentity = {
  spectatorIdentity?: boolean;
  name?: string | null;
  isAgent?: boolean;
  channel?: string | null;
  codename?: string | null;
  ownerGamertag?: string | null;
  environmentLabel?: string | null;
};

export function isAgentIdentity(player: PlayerIdentity): boolean {
  return Boolean(player.isAgent || player.channel === "mcp");
}

export function playerPrimaryName(player: PlayerIdentity, fallback = "Player"): string {
  if (isAgentIdentity(player)) {
    return player.codename?.trim() || player.name?.trim() || fallback;
  }

  return player.ownerGamertag?.trim() || player.name?.trim() || fallback;
}

export function playerIdentityDetail(player: PlayerIdentity): string | null {
  if (!isAgentIdentity(player)) return null;

  const parts = [player.environmentLabel?.trim(), player.ownerGamertag?.trim()].filter(
    (part): part is string => Boolean(part),
  );

  return parts.length > 0 ? parts.join(" · ") : null;
}

export function playerInlineName(player: PlayerIdentity, fallback = "Player"): string {
  const primary = playerPrimaryName(player, fallback);
  const detail = playerIdentityDetail(player);

  return detail ? `${primary} · ${detail}` : primary;
}
