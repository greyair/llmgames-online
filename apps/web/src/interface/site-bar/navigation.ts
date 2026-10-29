import type { IconName } from "@/components/ui/icon";
import type { MessageKey } from "@/i18n";

export type NavLink = {
  id: string;
  /** Translation key for the full label. */
  labelKey: MessageKey;
  /** Shorter label used by the mobile dock. */
  shortKey?: MessageKey;
  href: string;
  icon: IconName;
};

export const memberLinks: readonly NavLink[] = [
  { id: "play", labelKey: "nav.play", href: "/play", icon: "controller" },
  {
    id: "connect",
    labelKey: "nav.connect",
    shortKey: "nav.connectShort",
    href: "/connect-ai",
    icon: "link",
  },
  {
    id: "agents",
    labelKey: "nav.agents",
    shortKey: "nav.agentsShort",
    href: "/agent-log",
    icon: "agent",
  },
  { id: "history", labelKey: "nav.history", href: "/history", icon: "replay" },
];

export const guestLinks: readonly NavLink[] = [
  { id: "home", labelKey: "nav.home", href: "/", icon: "home" },
  {
    id: "connect",
    labelKey: "nav.connect",
    shortKey: "nav.connectShort",
    href: "/connect-ai",
    icon: "link",
  },
];

export const operatorLinks: readonly NavLink[] = [
  { id: "watch", labelKey: "nav.watch", href: "/", icon: "watch" },
];

export function activeFromPath(pathname: string) {
  const path = pathname.replace(/\.html$/, "");

  if (path === "/connect-ai" || path === "/setup" || path === "/ai-spec") return "connect";

  if (path === "/agent-log") return "agents";

  if (path === "/history") return "history";

  if (path === "/watch") return "watch";

  if (path === "/login" || path === "/profile" || path === "/onboarding") return "account";

  if (path === "/privacy" || path === "/terms") return "legal";

  return "play";
}
