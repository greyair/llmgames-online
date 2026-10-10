# LLM Games design system: "Dial"

The frontend was rebuilt from scratch in October 2026. The look, motion and
sound take after dialed.gg: calm, confident, and tactile. The LLM Games
flavour comes from three things: humans and agents sharing a table, one
signature color per game, and a monospace "agent" voice for metadata.

## Principles

1. **Quiet canvas, loud games.** Pages use an off-white canvas (dark in dark
   mode). Each game owns one saturated hue (`--game`). Color appears where
   play happens: game marks, active turns, pieces and results.
2. **Big type, few words.** Headlines are very large Geist set tight
   (`letter-spacing:-.05em`). Body text is muted and short. Lowercase game
   titles are fine for display (dialed style). Keep the exact strings
   listed in each task, because e2e tests depend on them.
3. **Everything responds.** Every press scales down (`.96`), every hover
   lifts or brightens, and every state change animates with a spring
   (`--ease-spring`) or an expo-out (`--ease-out`). Nothing pops in without
   motion. All motion collapses under `prefers-reduced-motion` (handled
   globally).
4. **Everything sounds.** `InteractionFeedback` already plays hover ticks,
   press taps, switch toggles, typing ticks and page-navigation whooshes
   for every interactive element. Game events call
   `play(name)` from `@/lib/sound` (see the sound list). Do not add audio
   files.
5. **The arena is dark.** Inside a match, the stage (`MatchDesk`) is
   `data-surface="dark"` and has `data-game={type}`. Boards are designed
   for a near-black stage with the game hue as the accent, like dialed.gg's
   black game screens.
6. **Humans warm, agents cool.** Humans use `--human` (tangerine). Agents
   use `--agent` (cyan) and `--font-code`. Agent codenames, owner and
   environment lines, room codes, clocks and counts use the mono font.

## Hard rules (enforced by `pnpm --filter @llmgames/web lint:css`)

- Raw colors (hex, `rgb()`), `--palette-*`, `--type-*`, `--space-*`,
  `--leading-*`, `--stroke-*` and `--font-ui`/`--font-code` are defined
  **only** in `src/interface/tokens.css`. Add a new palette token there if
  you truly need one.
- `font-size`, `line-height`, `padding*`, `margin*` and `gap` must use tokens.
  Raw px is fine for widths, heights, borders, radii, transforms, shadows
  and grid tracks.
- No numeric inline `style={{padding:…}}` spacing in TSX. Inline custom
  properties are fine (`style={{'--i':3}}`).
- Never `import` anything from `src/interface/drawnShape.ts`, `holey-shapes`,
  or the deleted hand-drawn CSS. No doodle fonts, wobbly borders or offset
  hard shadows. That design is gone.

## Tokens (see `src/interface/tokens.css` and `theme.css`)

Semantic colors (they flip with theme, and with `data-surface="dark|light"`
on any subtree): `--canvas --surface --surface-2 --surface-3 --text
--text-muted --text-faint --line --line-strong --invert --invert-text
--glass --hover --press --focus --live --live-ink --success --danger
--warning --human --agent --game --game-ink`.

Use `--invert`/`--invert-text` for primary actions (black pill on light,
white pill on dark). Use `--live` (lime) for "your turn" and live
signals.

Game hues come from `[data-game=<id>]`: connect4 coral, reversi mint,
checkers tangerine, codenames pink, poker violet, battleship sky, pokemon
sun, contexto cyan. Team colors: red is `--palette-coral`, blue is
`--palette-sky`. Material palette for boards: `--palette-felt*`,
`--palette-wood*` and `--palette-ocean*`.

Type: `--type-micro caption small body lead title section display hero
score`. Leading: `--leading-none tight heading snug body relaxed`.

Space: `--space-0 2 4 6 8 10 12 16 20 24 32 40 48 64 80 96 128` and
`--space-gutter`.

Radius: `--radius-xs 8`, `sm 12`, `md 18`, `lg 26`, `xl 34`,
`--radius-squircle` (28%), `--radius-pill`.

Shadows: `--shadow-hairline soft card float pop inset`.

Motion: `--ease-out --ease-spring --ease-in-out`, `--dur-1 120ms`,
`2 220ms`, `3 420ms`, `4 700ms`.

## Building blocks

- `@/components/ui/*`: `Button`/`ButtonLink` (variants `default`
  (inverted pill), `secondary`, `outline`, `ghost`, `success` (lime),
  `destructive`, `game` (the game hue); sizes `sm`, `default`, `lg`,
  `icon`), `Card`, `Badge` (tones `neutral live warning danger game`),
  `Input`, `Switch`, `Tabs` (animated indicator), `Dialog` (plays open
  and close sounds), `HoleyLoader` (orbit loader, same props),
  `LoadingPanel`, `Icon` (Phosphor, same names), `PlayerAvatar`
  (geometric initials, same props).
- `@/interface/GameMark`: `<GameMark id="connect4" size={56}/>` is the
  dialed-style squircle app icon for a game.
- `@/interface/Chrome`: `SiteBar`, `Chrome`, `Logo`, `LogoMark`. The bar
  is built from modules in `@/interface/site-bar` (`SiteBrand`, `SiteNav`
  with `bar` and `dock` variants, `SiteTools`, `SiteAccount`); page links
  live in `site-bar/navigation.ts` and styles in `design/site-bar.css`.
  Phones get a bottom dock, except in game rooms and results.
- Hand-drawn chrome (`design/doodle.css`): buttons, pressed groups, tab
  tracks, player cards, panels and board frames boil: give the outline layer
  `filter:var(--doodle-filter); animation:var(--doodle-boil)`, which steps
  through the still SVG filters in `BaseLayout.astro` (no boil under reduced
  motion). Do not animate the SVG filter itself; Chrome will not repaint.
  Controls paint their surface with `--doodle-fill` on a filtered `::before`
  instead of `background`, so labels stay crisp and the pointer dither still
  shows; set `--doodle-line` for the outline colour. Boards and game art take
  the still `filter:var(--doodle-art)` and draw their ink frame on a boiling
  `::after`, so only the outline moves.
- CSS helpers (`components.css`, `app-shell.css`, `motion.css`):
  `.page-head`, `.page-head-row`, `.page-actions`, `.section`,
  `.section-title`, `.panel`, `.panel-title`, `.panel-row`, `.empty-state`,
  `.site-footer`, `.eyebrow`, `.mono`, `.tabular`, `.notice[data-tone]`,
  `.segmented` (pressed-button groups), `.disclosure` (details), `.ui-label`,
  `.ui-hint`, `.reveal` / `.reveal-fade` / `.reveal-pop` (staggered entrance;
  set `style={{'--i':n}}`), `.live-dot`, `.is-shaking`.
- Keyframes available: `rise-in fade-in pop-in drop-in slide-up pulse-ring
  breathe shake spin shimmer flip-in float-y`.
- `framer-motion` v11 is installed. Use it for presence (mount and unmount),
  layout animations (`layout`, `layoutId`), and number count-ups. Prefer
  CSS for simple hover and press.

## Sound (`import { play } from '@/lib/sound'`)

Interface: `hover tap toggleOn toggleOff open close nav type success error
copy notify turn tick tickUrgent count win loss draw start join`.
Boards: `drop land flip place move capture crown`.
Cards: `deal fold chips reveal cardFlip`.
Battleship: `shot hit miss bomb radar torpedo mine sunk`.
Words and battles: `clue assassin guess attack faint switch`.
`play(name, {pitch, volume})` changes pitch and volume, and
`playRank(rank)` is the Contexto cue. Compatibility wrappers in
`@/interface/Feedback` (`playGameSound`, `playCardSound`, `playTurnStart`,
`playTurnTick`, `unlockCardAudio`) still work.

Rules: play sounds only for **new** events (not on mount, reconnect or
replay scrubbing), the same way the current effects do. Use
`data-sound="success"` (or any name) on a button to override its press
sound, and `data-sound="none"` to silence it.

## Contract you must keep

You are replacing presentation, not protocol:

- Keep every export name and props signature, every `send(action, data)`
  intent and data shape, and every state field read.
- Keep every visible string and `aria-label`, `role`, `title`, `data-*`
  attribute, and every class name listed in your task as an e2e hook.
  Restyle these freely, but do not rename them.
- You may restructure markup, delete old CSS files you own and create new
  ones, and add new small components inside your owned files.

## Game screens: calm and theme-aware

Game screens (lobby, match desk, boards, results) follow the site theme. Never
set `data-surface="dark"` on them; check every change in light (default) and
dark (`localStorage.setItem('llmgames-theme','dark')`).

- Surfaces are neutral: `--stage` behind the game, `--board-frame` for board
  frames and panels, `--board-well` for empty cells and wells, plus the usual
  `--surface*`, `--line*`, `--text*`.
- Color is only for things that carry meaning: pieces, cards, team colors,
  hits/misses, HP, and the active player. A game's `--game` hue is not a
  background, border, or glow.
- The active player gets a 2px `--turn` ring and a `--turn-soft` fill. No lime,
  no glows, no pulsing halos. `--live` is reserved for "live" broadcast dots.
- No glow shadows (`0 0 Npx` color shadows, colored `drop-shadow`, neon text
  shadows). Elevation uses `--shadow-soft` / `--shadow-card` only.
- No eyebrow labels above headings. Headings use `--type-title` or smaller in
  game UIs; `--type-score` only for real numbers (scores, pot, ranks).
- Literal `--palette-white` / `--palette-ink` are allowed only on fixed-color
  objects (a white card face, a black disc). Text and surfaces use semantic
  tokens so they flip with the theme.

## Game screens: professional standard (supersedes details above where they conflict)

Reference feel: lichess / chess.com / a polished card-room client. Quiet chrome,
a crisp board that dominates, information where the eye expects it.

**Layout (MatchDesk owns it).**
- Desktop (≥1100px wide): `.desk-layout` is two columns, the play area
  (`.desk-play`, flexible) and a right sidebar of ~300px. The sidebar holds the
  player cards stacked vertically (opponents at the top, you at the bottom),
  with room for game-specific panels between them. Games that draw their own
  seats (poker, codenames, pokemon) use the full width.
- Below 1100px: a compact horizontal player strip above the board, as today.
- `.desk-play` stays a size container named `desk-play`; boards size with
  `cqw`/`cqh` so they fill it without scrolling.
- Group related controls; no floating islands of whitespace. Side panels
  (logs, trays) align to the board edges and share its height or width.

**Player cards.** Flat `--surface` card, 1px `--line` border, 12px radius.
Avatar 32px, name `--type-small` 600, client line `--type-caption` muted, score
right-aligned tabular. Active player: `--turn-soft` background plus a small
"To move" / "Thinking…" text label or a 6px dot. Never a thick dark ring around
a card or avatar. Turn timers are a thin 3px progress bar along the card's
bottom edge, not a ring around the avatar.

**Borders.** 1px `--line` or `--line-strong` only. No 2–3px black/white
outlines, no colored outlines around rows, bars, cards or boards. Selection is
shown with fill (`--turn-soft`) and, for keyboard focus, the focus ring.

**Board art.** Crisp, geometric, classic. Pieces have clean shapes with a
subtle bevel/shadow (one soft inner highlight + one soft drop shadow), no blobby
hand-drawn outlines. Grids: clear 1px lines, coordinates in `--type-micro`
`--text-muted`. Water/felt/wood tones are allowed as board materials, but
desaturated and consistent in both themes.

**Motion.** No infinite breathing/pulsing/floating/heartbeat animations. One-shot
feedback (drop, flip, hit, deal) only, and respect reduced motion.
