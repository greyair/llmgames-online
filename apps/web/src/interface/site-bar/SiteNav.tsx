import { useLayoutEffect, useRef } from "react";
import { Icon } from "@/components/ui/icon";
import { useT } from "@/i18n";
import type { NavLink } from "./navigation";

type SiteNavProps = {
  links: readonly NavLink[];
  current: string;
  highlight?: string;
  variant: "bar" | "dock";
};

type Box = { x: number; y: number; w: number; h: number };

type Placed = Box & { highlight: string; linkSet: string };

const sameBox = (a: Box, b: Box) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

const frame = (el: HTMLElement) => {
  const style = getComputedStyle(el);

  return { translate: style.translate, width: style.width, height: style.height };
};

const token = (el: HTMLElement, name: string) => getComputedStyle(el).getPropertyValue(name).trim();

// Leaves CSS animations (the outline boil) running; cancelling one stops it for good.
const cancelSlide = (el: HTMLElement) =>
  el.getAnimations().forEach((animation) => {
    if (!(animation instanceof CSSAnimation)) animation.cancel();
  });

/** Page links with one hand-drawn sun pill that slides to the highlighted page; hover and focus show a soft pill.
    `highlight` runs ahead of `current` during a client-side navigation, so the pill moves on click.

    The pill is a single element placed from the highlighted link's measured box. A slide always starts from
    where the pill is drawn right now, and only happens when the highlight changes within the same set of links:
    first paint, resizes, font swaps and the guest-to-member switch place it without moving. The slide uses the
    Web Animations API because a page swap replaces stylesheets, which would cancel a CSS transition mid-way. */
export function SiteNav({ links, current, highlight = current, variant }: SiteNavProps) {
  const nav = useRef<HTMLElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const placed = useRef<Placed | null>(null);
  const linkSet = links.map((link) => link.id).join(".");
  const t = useT();

  useLayoutEffect(() => {
    const root = nav.current,
      mark = pill.current;

    if (!root || !mark) return;

    const place = (slide: boolean) => {
      const prev = placed.current;
      const link = root.querySelector<HTMLElement>("a[data-highlighted]");

      if (!link || !link.offsetWidth) {
        cancelSlide(mark);
        placed.current = null;
        delete root.dataset.pill;

        return;
      }

      // Rects keep sub-pixel widths, so the pill's outline lines up with the link exactly.
      const at = link.getBoundingClientRect(),
        origin = root.getBoundingClientRect();

      const box = {
        x: at.left - origin.left - root.clientLeft,
        y: at.top - origin.top - root.clientTop,
        w: at.width,
        h: at.height,
      };

      // Resize callbacks with an unchanged box must not interrupt a slide.
      if (prev && prev.highlight === highlight && sameBox(prev, box)) return;

      const from =
        slide && prev?.linkSet === linkSet && prev.highlight !== highlight ? frame(mark) : null;

      cancelSlide(mark);
      placed.current = { ...box, highlight, linkSet };
      mark.style.setProperty("--pill-x", `${box.x}px`);
      mark.style.setProperty("--pill-y", `${box.y}px`);
      mark.style.setProperty("--pill-w", `${box.w}px`);
      mark.style.setProperty("--pill-h", `${box.h}px`);
      root.dataset.pill = "";

      if (!from || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      mark.animate([from, frame(mark)], {
        duration: parseFloat(token(root, "--dur-4")) || 340,
        easing: token(root, "--ease-out") || "ease-out",
      });
    };

    place(true);
    const observer = new ResizeObserver(() => place(false));
    observer.observe(root);
    root.querySelectorAll("a").forEach((link) => observer.observe(link));

    return () => observer.disconnect();
  }, [highlight, linkSet]);

  // Until the first measurement (server render and hydration), CSS draws the pill on the highlighted link itself.
  return (
    <nav
      ref={nav}
      aria-label={t("nav.label")}
      className={variant === "bar" ? "site-nav" : "site-dock"}
      data-variant={variant}
    >
      <span ref={pill} className="site-nav-indicator" aria-hidden="true" />
      {links.map((item) => {
        const full = t(item.labelKey);
        const label = variant === "dock" && item.shortKey ? t(item.shortKey) : full;

        return (
          <a
            key={item.id}
            href={item.href}
            data-astro-prefetch="hover"
            aria-label={label === full ? undefined : full}
            aria-current={item.id === current ? "page" : undefined}
            data-highlighted={item.id === highlight || undefined}
          >
            {variant === "dock" && <Icon name={item.icon} size={18} className="site-nav-icon" />}
            <span className="site-nav-label">{label}</span>
          </a>
        );
      })}
    </nav>
  );
}
