import { expect, test } from "@playwright/test";

test("scroll containers hide scrollbar chrome without disabling scrolling", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/design-preview/contexto");

  const result = await page.locator(".contexto-own-list").evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error("Expected HTML scroll container");
    const list = element;
    list.style.height = "120px";
    const original = list.innerHTML;
    list.innerHTML = "<li>one guess</li>";
    const quietWidth = list.clientWidth;
    list.innerHTML = Array.from({ length: 40 }, (_, index) => `<li>guess ${index + 1}</li>`).join(
      "",
    );
    const scrollingWidth = list.clientWidth;
    const style = getComputedStyle(list);
    const scrollbar = getComputedStyle(list, "::-webkit-scrollbar");
    list.scrollTop = 80;
    const scrollTop = list.scrollTop;
    list.innerHTML = original;
    list.style.height = "";

    return {
      gutter: style.scrollbarGutter,
      width: style.scrollbarWidth,
      webkitDisplay: scrollbar.display,
      webkitWidth: scrollbar.width,
      quietWidth,
      scrollingWidth,
      scrollTop,
    };
  });

  expect(result.gutter).toBe("auto");
  expect(result.width).toBe("none");
  expect(result.webkitDisplay).toBe("none");
  expect(result.webkitWidth).toBe("0px");
  expect(result.scrollingWidth).toBe(result.quietWidth);
  expect(result.scrollTop).toBeGreaterThan(0);

  const clippedBoard = await page.locator(".contexto-stage").evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error("Expected HTML board");

    return {
      gutter: getComputedStyle(element).scrollbarGutter,
      overflow: getComputedStyle(element).overflow,
      offsetWidth: element.offsetWidth,
      clientWidth: element.clientWidth,
    };
  });

  expect(clippedBoard.overflow).toBe("hidden");
  expect(clippedBoard.gutter).toBe("auto");
  expect(clippedBoard.clientWidth).toBe(clippedBoard.offsetWidth);

  await page.locator(".contexto-own-list").evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error("Expected HTML scroll container");
    element.style.height = "120px";
  });
  await page.locator(".contexto-own").screenshot({ path: info.outputPath("hidden-scrollbar.png") });
  await page.locator(".contexto-own-list").evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error("Expected HTML scroll container");
    element.style.height = "";
  });
});

test("mobile game scrollers hide scrollbar chrome", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/design-preview/contexto");
  await expect(page.locator(".contexto-stage")).toBeVisible();
  expect(
    await page.locator(".contexto-stage").evaluate((element) => ({
      gutter: getComputedStyle(element).scrollbarGutter,
      width: getComputedStyle(element).scrollbarWidth,
      webkitDisplay: getComputedStyle(element, "::-webkit-scrollbar").display,
    })),
  ).toEqual({ gutter: "auto", width: "none", webkitDisplay: "none" });
});
