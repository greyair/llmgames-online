// Optional original artwork tests require pnpm assets:pokemon.
import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";

const hasArtwork = existsSync(new URL("../public/pokemon/gen1/charizard.png", import.meta.url));

test("Battle sprites animate locally and respond to reduced motion", async ({ page }) => {
  test.skip(!hasArtwork, "Optional third-party artwork is not installed");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/design-preview/pokemon?state=choice-locked");
  await expect(page.locator(".poke-field")).toBeVisible();
  await page.getByText("Demo controls", { exact: true }).click();
  await page.getByRole("checkbox", { name: "Auto battle" }).uncheck();
  const sprites = page.locator(".poke-platform .poke-sprite");
  await expect(sprites).toHaveCount(2);
  await expect(page.locator(".poke-combatant[data-own=true] .poke-platform img")).toHaveAttribute(
    "src",
    /gen5ani-back\/charizard.gif$/,
  );
  await expect(page.locator(".poke-combatant[data-own=false] .poke-platform img")).toHaveAttribute(
    "src",
    /gen5ani\/blastoise.gif$/,
  );
  await expect
    .poll(() =>
      sprites.evaluateAll((images) =>
        images.every(
          (image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
        ),
      ),
    )
    .toBe(true);
  await expect(page.locator(".poke-roster img[data-animated=true]")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".poke-platform img[data-animated=true]")).toHaveCount(0);
  await expect(sprites.first()).toHaveAttribute("src", /\.png$/);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator(".poke-platform img[data-animated=true]")).toHaveCount(2);
});

test("An unavailable animation falls back to its still sprite", async ({ page }) => {
  test.skip(!hasArtwork, "Optional third-party artwork is not installed");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.route("**/pokemon/gen5ani*/**", (route) => route.abort());
  await page.goto("/design-preview/pokemon?state=choice-locked");
  const sprites = page.locator(".poke-platform img");
  await expect(sprites).toHaveCount(2);
  await expect
    .poll(() =>
      sprites.evaluateAll((images) =>
        images.every(
          (image) =>
            image.getAttribute("src")?.endsWith(".png") &&
            image instanceof HTMLImageElement &&
            image.naturalWidth > 0,
        ),
      ),
    )
    .toBe(true);
});

test("Absent third-party sprites show the OSS placeholder", async ({ page }) => {
  await page.route(
    /\/pokemon\/(?:gen1|gen1-back|full-back|gen5ani|gen5ani-back)\/[^/]+\.(?:gif|png)$/,
    (route) => route.abort(),
  );
  await page.goto("/design-preview/pokemon?state=choice-locked");
  const sprites = page.locator(".poke-platform img");
  await expect(sprites).toHaveCount(2);
  await expect
    .poll(() =>
      sprites.evaluateAll((images) =>
        images.every(
          (image) =>
            image instanceof HTMLImageElement &&
            image.getAttribute("src") === "/pokemon/placeholder.svg" &&
            image.naturalWidth > 0,
        ),
      ),
    )
    .toBe(true);
});
