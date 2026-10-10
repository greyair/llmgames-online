import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const focusRing = (node: Element) => {
  const s = getComputedStyle(node);

  if (
    s.outlineStyle !== "none" &&
    parseFloat(s.outlineWidth) > 0 &&
    s.outlineColor !== "rgba(0, 0, 0, 0)"
  )
    return true;
  const ring = s.boxShadow.match(/0px 0px 0px ([0-9.]+)px/);

  return Boolean(ring && parseFloat(ring[1]!) > 0);
};

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
])
  test(`doodle components ${viewport.width}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/design-preview/components");
    await expect(page.getByRole("heading", { name: "Game essentials" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const home = page.getByRole("link", { name: "Home", exact: true });
    await home.focus();
    expect(await home.evaluate(focusRing)).toBe(true);

    const focusTargets = [
      page.getByRole("button", { name: "Play", exact: true }),
      page.getByLabel("Room code"),
      page.getByRole("tab", { name: "Play", exact: true }),
      page.getByRole("switch", { name: "Preview sound effects" }),
    ];

    for (const target of focusTargets) {
      await target.focus();
      await expect.poll(() => target.evaluate(focusRing)).toBe(true);
    }

    await page.getByRole("button", { name: "Play", exact: true }).focus();
    await page.screenshot({ path: info.outputPath("components.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );

    const audit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    expect(
      audit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
    ).toEqual([]);
    await page.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(page.getByLabel("Room code")).toHaveAttribute("aria-invalid", "true");
    await page.getByLabel("Room code").fill("ab1234");
    await expect(page.getByLabel("Room code")).toHaveValue("AB1234");
    await page.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(page.getByText("Room code accepted in demo")).toBeVisible();
    await page.getByRole("tab", { name: "Play", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Watch", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tabpanel", { name: "Watch", exact: true })).toContainText(
      "spectator",
    );
    const toggle = page.getByRole("switch", { name: "Preview sound effects" });
    await toggle.focus();
    await page.keyboard.press("Space");
    await expect(toggle).not.toBeChecked();
    const trigger = page.getByRole("button", { name: "Leave match", exact: true });
    await trigger.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: info.outputPath("dialog.png") });

    const modalAudit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();

    expect(modalAudit.violations.map((v) => v.id)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await page.keyboard.press("Tab");
    await page.getByRole("button", { name: "Play", exact: true }).focus();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await page.getByRole("button", { name: "Play", exact: true }).evaluate(focusRing)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath("components-dark-focus.png"), fullPage: true });
  });
