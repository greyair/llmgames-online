import type { IconName } from "@/components/ui/icon";

export type NavLink = { id: string; title: string; href: string; icon: IconName; short?: string };

export const memberLinks: readonly NavLink[] = [
  { id: "play", title: "Play", href: "/play", icon: "controller" },
  { id: "connect", title: "Connect AI", short: "Connect", href: "/connect-ai", icon: "link" },
  { id: "agents", title: "Agent log", short: "Agents", href: "/agent-log", icon: "agent" },
  { id: "history", title: "History", href: "/history", icon: "replay" },
];

export const guestLinks: readonly NavLink[] = [
  { id: "home", title: "Home", href: "/", icon: "home" },
  { id: "connect", title: "Connect AI", short: "Connect", href: "/connect-ai", icon: "link" },
];

export const operatorLinks: readonly NavLink[] = [
  { id: "watch", title: "Watch", href: "/", icon: "watch" },
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
