import { ThemeToggle } from "@/interface/ThemeToggle";
import { useEffect, useState } from "react";
import { previewStateLabel, previewStateGroups } from "./previewCatalog";
import { GameMark } from "@/interface/GameMark";
import "./preview-hub.css";
import { gameRouteSlug } from "@llmgames/game-catalog";

const games = [
  ["contexto", "Contexto"],
  ["connect4", "Connect 4"],
  ["checkers", "Checkers"],
  ["reversi", "Reversi"],
  ["codenames", "Codenames"],
  ["poker", "Poker"],
  ["battleship", "Battleship"],
  ["placement", "Fleet placement"],
  ["pokemon", "Pokémon"],
] as const;

const sections = [
  ["public-pages", "Public pages"],
  ["account", "Account & sign-in"],
  ["rooms", "Room setup"],
  ["spectator", "Spectator"],
  ["components", "Components & brand"],
  ...games,
] as const;

type Group = { label: string; links: { label: string; href: string }[] };

const link = (label: string, href: string) => ({ label, href });

const preview = (screen: string, state = "playing") =>
  `/design-preview/${gameRouteSlug(screen)}?state=${state.replace("contexto", "contexto")}`;

const publicGroups: Group[] = [
  {
    label: "Explore",
    links: [
      link("Landing page", "/design-preview/public/landing"),
      link("Game library", preview("library")),
      link("Connect your AI", preview("connect-ai")),
    ],
  },
  {
    label: "Legal",
    links: [
      link("Terms of service", "/design-preview/public/terms"),
      link("Privacy policy", "/design-preview/public/privacy"),
    ],
  },
];

const accountGroups: Group[] = [
  {
    label: "Sign in",
    links: ["signed-out", "auth-loading", "auth-error", "auth-code", "auth-onboarding"].map(
      (state) => link(previewStateLabel(state), preview("library", state)),
    ),
  },
  {
    label: "OAuth connection",
    links: [
      link("Allow access", "/design-preview/public/oauth"),
      link("Connected", "/design-preview/public/oauth?state=connected"),
      link("Request expired", "/design-preview/public/oauth?state=expired"),
    ],
  },
  {
    label: "Your account",
    links: [
      ...["jev-disconnected", "jev-connected"].map((state) =>
        link(previewStateLabel(state), preview("profile", state)),
      ),
      link("Agent log", preview("agent-log")),
      link("History & replays", preview("history", "featured")),
    ],
  },
];

function selection(value: string) {
  const [section, chosen] = value.split("/");

  if (games.some(([id]) => id === section)) return { section: section!, game: section! };

  if (section === "games" && games.some(([id]) => id === chosen))
    return { section: chosen!, game: chosen! };

  if (section === "social") return { section: "components", game: "connect4" };

  if (["profile", "history", "agent-log"].includes(section ?? ""))
    return { section: "account", game: "connect4" };

  if (section === "setup") return { section: "rooms", game: "connect4" };

  if (["landing", "library", "connect-ai"].includes(section ?? ""))
    return { section: "public-pages", game: "connect4" };

  return {
    section: sections.some(([id]) => id === section) ? section! : "public-pages",
    game: games.some(([id]) => id === chosen) ? chosen! : "connect4",
  };
}

export default function PreviewHub() {
  const read = () =>
    location.hash.slice(1) || new URLSearchParams(location.search).get("screen") || "public-pages";

  const [value, setValue] = useState(read);
  useEffect(() => {
    const update = () => setValue(read());
    window.addEventListener("hashchange", update);
    window.addEventListener("popstate", update);

    return () => {
      window.removeEventListener("hashchange", update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  const { section, game } = selection(value);
  let groups: Group[];

  if (section === "public-pages") groups = publicGroups;
  else if (section === "account") groups = accountGroups;
  else if (section === "rooms")
    groups = [
      {
        label: "Create / join a room",
        links: games.flatMap(([id, name]) =>
          id === "placement" ? [] : [link(name, preview(id, "room-setup"))],
        ),
      },
      ...previewStateGroups("setup")
        .filter((group) => group.label !== "Sign-in states" && group.label !== "Overview")
        .map((group) => ({
          label: group.label,
          links: group.states.map((state) =>
            link(previewStateLabel(state), preview("setup", state)),
          ),
        })),
    ];
  else if (section === "components")
    groups = [
      {
        label: "Shared design",
        links: [
          link("Interactive components", preview("components")),
          link("Logo & social image", preview("social")),
        ],
      },
    ];
  else {
    const screen = section === "spectator" ? "spectator" : section === "rooms" ? "setup" : game;
    groups = previewStateGroups(screen)
      .filter((group) => group.label !== "Sign-in states")
      .map((group) => ({
        label: group.label,
        links: group.states.map((state) => link(previewStateLabel(state), preview(screen, state))),
      }));
  }

  return (
    <main className="preview-directory" data-surface="dark">
      <div className="preview-theme-bar">
        <a href="/design-preview/public/landing">llmgames</a>
        <ThemeToggle />
      </div>
      <h1>Design previews</h1>
      <p>
        Related screens, together. Each game has its own states. Shared account pages live in one
        place.
      </p>
      <div className="preview-workspace">
        <nav className="preview-sidebar" aria-label="Preview sets">
          {sections.map(([id, name]) => (
            <a key={id} href={`#${id}`} aria-current={section === id ? "page" : undefined}>
              {games.some(([game]) => game === id) ? (
                <GameMark id={id === "placement" ? "battleship" : id} size={22} />
              ) : (
                <span className="preview-sidebar-dot" aria-hidden="true" />
              )}
              {name}
            </a>
          ))}
        </nav>
        <div className="preview-content">
          <section aria-labelledby="preview-set-title">
            <header className="preview-set-header">
              {games.some(([id]) => id === section) && (
                <GameMark id={section === "placement" ? "battleship" : section} size={48} />
              )}
              <h2 id="preview-set-title">{sections.find(([id]) => id === section)?.[1]}</h2>
              {games.some(([id]) => id === section) && (
                <a
                  href={preview(section)}
                  target="_blank"
                  rel="noreferrer"
                  className="preview-open"
                >
                  Open preview ↗
                </a>
              )}
            </header>
            <div className="preview-state-groups">
              {groups.map((group) => (
                <div className="preview-state-group" key={group.label}>
                  <h3>{group.label}</h3>
                  <ul>
                    {group.links.map((item) => (
                      <li key={item.href}>
                        <a
                          href={item.href}
                          target={item.href.startsWith("#") ? undefined : "_blank"}
                          rel="noreferrer"
                        >
                          {item.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
