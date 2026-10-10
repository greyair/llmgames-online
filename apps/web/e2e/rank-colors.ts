import type { Locator } from "@playwright/test";
import { CONTEXTO_HEAT_INK } from "../src/game-ui/contextoRankStyle";

const heatPalette = { ...CONTEXTO_HEAT_INK };

export type RankRowColors = {
  rank: number;
  heat: string | null;
  fill: number[];
  expectedFill: number[];
  text: number[];
  bar: number[];
  surface: number[];
  expectedSurface: number[];
  expectedText: number[];
  barContrast: number;
  surfaceContrast: number;
};

/** Reads a Contexto rank row's rendered colors as sRGB so contrast checks work for oklab and color-mix values. */
export function rankRowColors(row: Locator): Promise<RankRowColors> {
  return row.evaluate((element, palette) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;

    const rgb = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = "#000";
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;

      return [r!, g!, b!, a!];
    };

    const resolve = (value: string) => {
      const probe = document.createElement("span");
      probe.style.color = value;
      element.parentElement!.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();

      return rgb(color);
    };

    const luminance = ([r, g, b]: number[]) => {
      const c = [r!, g!, b!].map((v) => {
        const s = v / 255;

        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });

      return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    };

    const contrast = (a: number[], b: number[]) => {
      const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);

      return (x! + 0.05) / (y! + 0.05);
    };

    const style = getComputedStyle(element);
    const heat = element.getAttribute("data-heat");
    const heatInk = Object.entries(palette).find(([key]) => key === heat)?.[1];

    const text = rgb(style.color),
      bar = rgb(getComputedStyle(element, "::before").backgroundColor),
      track = getComputedStyle(element, "::after"),
      surface = rgb(track.content !== "none" ? track.backgroundColor : style.backgroundColor);

    return {
      rank: Number(element.querySelector("strong:last-child")?.textContent?.replace(/,/g, "")),
      heat: element.getAttribute("data-heat"),
      fill: rgb(style.getPropertyValue("--rank-fill").trim()),
      expectedFill: resolve(`var(--palette-${heatInk})`),
      text,
      bar,
      surface,
      // Rows draw a paper track on ::after; the newest guess gets a sun-tinted track.
      expectedSurface: resolve(
        element.matches("[data-latest]")
          ? "color-mix(in oklab,var(--palette-sun) 55%,var(--palette-white))"
          : "var(--sketch-paper)",
      ),
      expectedText: resolve("var(--sketch-ink)"),
      barContrast: contrast(text, bar),
      surfaceContrast: contrast(text, surface),
    };
  }, heatPalette);
}
