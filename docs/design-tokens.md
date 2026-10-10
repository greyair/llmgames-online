# Web design system: Mono Dither

The web app uses one design system in `apps/web/src/design/`. `apps/web/src/index.css` imports the files in this order:

| File | Owns |
| --- | --- |
| `tokens.css` | Fixed palette (greys, riso brights, native game materials), type scale, spacing, control heights, radii, durations |
| `dither-masks.css` | Generated Bayer masks and ramps. Do not edit by hand; run `node scripts/generate-dither.mjs` |
| `theme.css` | Semantic aliases for light, dark and `[data-surface]` islands |
| `base.css` | Element defaults and focus rings |
| `dither.css` | Dither utilities: `.dither`, `.tone-*`, `.dither-plate`, `.dither-edge-*`, `.dither-rule`, `.dither-depth`, `.dither-blend`, `[data-dither-in]` |
| `motion.css` | Keyframes and reveal classes, all stepped and reduced-motion aware |
| `components.css` | Buttons, panels, badges, inputs, switch, tabs, dialog, loader, notices, segmented choices |
| `games.css` | `--game`, `--game-ink` and `--game-2` native colors per `[data-game]` |
| `shell.css` | Site bar, page heads, sections, footer |

Page and game styles live beside their components and use only these tokens. `game-ui/match-layout.css` is the shared match frame; each game keeps its own desk layout rules (`.match-desk[data-game=x]`) in its own stylesheet.

## Principles

- **Monochrome chrome.** Buttons, inputs, tabs, badges, plates, panels and accents use only white, greys and ink. Primary actions are ink pills with white text (white pills in dark mode). Secondary actions are grey pills. "Your turn" inverts a plate to ink.
- **Color lives in the games, in pastel.** Game boards use their canonical, real-world look (Connect 4 blue cabinet, green felt, wood checkers, card stock) in soft pastel tones with clean gradients. Game marks, avatars and celebrations are colorful. Status hues (live green, danger tomato) appear as small dots or on urgent states, not as colored fills on chrome.
- **Soft and borderless.** Controls are pills and cards use 24–32 px corners. Separation comes from grey fills. Only floating layers (menus, dialogs) cast a soft shadow.
- **Big and readable.** Body text is 16 px and nothing essential is below 12 px. Controls are 40, 48 or 56 px tall.
- **Dither is an accent, never a surface.** Ordered Bayer dithering (3 px cells) appears only in small, deliberate moments: the button hover wipe, the one-shot confirmation scan, the results burst, fine shading on the playable pieces (discs, checkers men, cards, chips, Codenames word cards, Contexto heat bars), and the native art of Battleship's sea and Pokémon's field. Never use dither on page backgrounds, panels, board surfaces or text.
- **Stepped motion.** Animations use `steps()` timing or `--steps-dither`. Under `prefers-reduced-motion`, motion is removed.

## Typography

| Role | Token |
| --- | --- |
| Smallest essential text | `--type-micro` (12 px) |
| Badges and metadata | `--type-caption` (13 px) |
| Supporting text | `--type-small` (14 px) |
| Body and form text | `--type-body` (16 px) |
| Lead text, large inputs | `--type-lead` (19 px) |
| Panel and dialog titles | `--type-title` (24 px) |
| Section and page headings | `--type-section`, `--type-display` (fluid) |
| Landing hero | `--type-hero` (fluid) |
| Clocks and scores | `--type-score` (36 px), `--type-mega` (fluid) |

`--font-ui` is Geist, `--font-code` is Geist Mono, and `--font-pixel` is Geist Pixel. UI titles use bold Geist with `--tracking-tight`. The pixel face is the retro signature: use it for `h1`, hero headlines, clocks, scores and counters, not for running text.

## Spacing, sizing and color

`--space-*` is a pixel scale from 0 to 128. Use it for margin, padding and gap. `--control-*`, `--bar-height`, `--content-max`, `--content-narrow` and `--sidebar` fix shared dimensions.

The `--palette-*` values are fixed and theme-independent: greys (`--palette-white`, `--palette-g50` to `--palette-g950`, `--palette-ink`, `--palette-black`), riso brights for art (`tomato`, `tangerine`, `sun`, `grass`, `sky`, `aqua`, `pink`), and native game materials (`--palette-c4-*`, `--palette-maple`, `--palette-walnut`, `--palette-reversi-*`, `--palette-baize`, `--palette-rail`, `--palette-card-*`, `--palette-chip-*`, `--palette-sea*`, `--palette-steel*`, `--palette-peg-*`, `--palette-cn-*`, `--palette-rank-*`, `--palette-pk-*`, `--palette-hp-*`, `--palette-type-*`).

Use the semantic aliases from `theme.css` for theme-aware UI: `--canvas`, `--surface*`, `--raised`, `--text*`, `--line*`, `--invert*`, `--accent*`, `--turn`, `--turn-text`, `--live`, `--danger` and `--warn`. The `--pop-1` to `--pop-7` rotation is for art only.

Game surfaces use `--stage`, `--board-frame`, `--board-well` and the per-game `--game` hue.

## Dither masks

- `--bayer-N` covers N/16 of each 4×4 cell, and `--bayer8-N` covers N/16 of each 8×8 cell. Tile them at `--dither-tile` or `--dither-tile-8`.
- `--ramp-up` and `--ramp-down` are 4×24 fades. Draw them at `var(--dither-tile) var(--ramp-length)` so cells stay square. Do not stretch them to 100%, or they band.
- To color a dither, put the color in `background` and the pattern in `mask`. For SVG pattern fills, define one pattern per tone, because `currentColor` in `<defs>` does not inherit from the element using the pattern.

## Art

- **Avatars** (`components/ui/player-avatar.tsx`). The design samples a holey shape hashed from the player's name on a 20×20 grid, then shades it with Bayer into fill, shade and glint paths. Agents get a corner dot.
- **Icons** (`components/ui/icon.tsx`). Icons are 9×9 pixel glyphs, and sizes snap to multiples of 9.
- **Game marks and scenes** (`interface/GameMark.tsx`, `interface/GameScene.tsx`). Marks are 8×8 glyphs, and scenes are 64×40 pixel scenes.
- **DitherField** (`components/ui/dither-field.tsx`). This is the Paper `Dithering` shader. It reads its colors from CSS variables, pauses offscreen and on hidden tabs, and falls back to a CSS plate.

## Enforcement

Run `pnpm --filter @llmgames/web lint:css`; `pnpm lint` also runs it. The check parses every authored CSS file in the web app. It rejects raw type sizes, positive fixed spacing, raw colors, raw line heights and references to undefined tokens. Raw pixel widths and heights are allowed for geometry. SVG data URLs are excluded.

`e2e/scenario-layout.spec.ts` steps through every preview state of every game at 390×844, 1440×900, 1280×720 and 844×390. It checks that each in-game screen fits one viewport without scrolling.
