import { expect, test } from "@playwright/test";

const scenarios = [
  "connect4",
  "reversi",
  "codenames",
  "poker",
  "poker-heads-up",
  "poker-showdown",
  "battleship",
  "pokemon",
  "contexto",
];

const viewports = [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
];

for (const viewport of viewports)
  for (const scenario of scenarios)
    test(`${scenario} broadcast fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/design-preview/spectator?state=watch-${scenario}`);

      const desk = page.locator(".match-desk[data-stream=true]"),
        board = page.locator(".desk-play");

      await expect(desk).toBeVisible();
      await expect(board).toBeVisible();

      const fit = await page.evaluate(() => {
        const viewport = { right: innerWidth, bottom: innerHeight };

        const nodes = [
          document.querySelector(".match-desk"),
          document.querySelector(".desk-bar"),
          document.querySelector(".desk-play"),
          document.querySelector(".desk-play>*"),
        ].filter((node): node is HTMLElement => node instanceof HTMLElement);

        return {
          documentWidth: document.documentElement.scrollWidth,
          documentHeight: document.documentElement.scrollHeight,
          nodes: nodes.map((node) => {
            const rect = node.getBoundingClientRect();

            return {
              name: node.className,
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              scrollWidth: node.scrollWidth,
              clientWidth: node.clientWidth,
              scrollHeight: node.scrollHeight,
              clientHeight: node.clientHeight,
              inside:
                rect.left >= -1 &&
                rect.top >= -1 &&
                rect.right <= viewport.right + 1 &&
                rect.bottom <= viewport.bottom + 1,
            };
          }),
        };
      });

      expect(fit.documentWidth).toBeLessThanOrEqual(viewport.width + 1);
      expect(fit.documentHeight).toBeLessThanOrEqual(viewport.height + 1);
      expect(
        fit.nodes.filter((node) => !node.inside),
        JSON.stringify(fit.nodes, null, 2),
      ).toEqual([]);
      expect(
        fit.nodes.filter(
          (node) =>
            node.scrollWidth > node.clientWidth + 10 ||
            (node.name !== "ships-stage" && node.scrollHeight > node.clientHeight + 10),
        ),
        JSON.stringify(fit.nodes, null, 2),
      ).toEqual([]);
    });
