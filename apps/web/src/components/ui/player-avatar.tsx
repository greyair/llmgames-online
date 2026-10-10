import { useId, useMemo, type CSSProperties } from "react";
import * as avatarArt from "@/vendor/holey-shapes";

const { createHoleySvg } = avatarArt;

const silhouettes = avatarArt.shapes;

/** Fill, shade and glint inks for each avatar palette. */
export const avatarColors = [
  ["Sky", "var(--palette-sky)", "var(--palette-sky-deep)", "var(--palette-white)"],
  ["Aqua", "var(--palette-aqua)", "var(--palette-aqua-deep)", "var(--palette-white)"],
  ["Pink", "var(--palette-pink)", "var(--palette-pink-deep)", "var(--palette-white)"],
  ["Grass", "var(--palette-grass)", "var(--palette-grass-deep)", "var(--palette-sun)"],
  ["Tomato", "var(--palette-tomato)", "var(--palette-tomato-deep)", "var(--palette-sun)"],
  ["Sun", "var(--palette-sun)", "var(--palette-sun-deep)", "var(--palette-white)"],
  ["Tangerine", "var(--palette-tangerine)", "var(--palette-tangerine-deep)", "var(--palette-sun)"],
  ["Steel", "var(--palette-steel)", "var(--palette-steel-deep)", "var(--palette-white)"],
] as const;

export const avatarSilhouettes = silhouettes.map(
  (silhouette) => [silhouette.name, silhouette.key] as const,
);

export function avatarAppearance(name: string) {
  const key = name.trim().toLocaleLowerCase("en-US") || "player";
  let hash = 2166136261;

  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  hash >>>= 0;
  const silhouette = Math.floor(hash / avatarColors.length) % silhouettes.length;
  const spare = Math.floor(hash / (avatarColors.length * silhouettes.length));

  return {
    key,
    seed: `avatar:${key}`,
    doodleSeed: hash % 1_000_001,
    palette: hash % avatarColors.length,
    "shape": silhouette,
    holes: 2 + (spare % Math.max(1, Math.min(5, silhouettes[silhouette]!.holes.length) - 1)),
    turn: (spare >>> 4) % 4,
  };
}

/** Native Holey doodles keep each player's shape and color consistent across views. */
export function PlayerAvatar({
  name = "player",
  size = 28,
  label = "Player avatar",
}: {
  name?: string;
  size?: number;
  label?: string;
}) {
  const look = avatarAppearance(name);
  const agent = name.startsWith("agent:");
  const maskId = `avatar-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const artwork = useMemo(
    () =>
      createHoleySvg({
        "shape": silhouettes[look.shape]!.key,
        holes: look.holes,
        seed: look.doodleSeed,
        doodle: true,
        animated: false,
      })
        .replace('role="img"', 'aria-hidden="true"')
        .replace(/ aria-label="[^"]*"/, "")
        .replaceAll('id="h"', `id="${maskId}"`)
        .replaceAll("url(#h)", `url(#${maskId})`),
    [look.shape, look.holes, look.doodleSeed, maskId],
  );

  const [, fill, shade, glint] = avatarColors[look.palette]!;

  return (
    <span
      className="player-avatar"
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      {...{ "data-avatar-shape": look.shape }}
      data-avatar-palette={look.palette}
      data-avatar-holes={look.holes}
      {...{ "data-shape": silhouettes[look.shape]!.key }}
      data-kind={agent ? "agent" : "human"}
      style={
        {
          "--avatar-size": `${size}px`,
          "--avatar-color": fill,
          "--avatar-shade": shade,
          "--avatar-glint": glint,
          "--avatar-turn": `${look.turn * 90}deg`,
        } satisfies CSSProperties & { [property: `--${string}`]: string | number | undefined }
      }
    >
      <span className="avatar-art" dangerouslySetInnerHTML={{ __html: artwork }} />
    </span>
  );
}
