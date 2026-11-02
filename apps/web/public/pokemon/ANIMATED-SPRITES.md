# Optional battle artwork

Original species images are not bundled in this OSS repository. Run
`pnpm assets:pokemon` to fetch hash-checked images into ignored local directories.
The battle engine and board work with the MIT generic placeholder by default.

The optional files come from https://play.pokemonshowdown.com/sprites/.
Credits: https://github.com/smogon/sprites. They belong to their respective
owners and are not covered by this repository's MIT license.

`scripts/pokemon/assets.json` lists each URL and SHA-256 digest. Downloaded
files remain local and must not be committed to this source distribution.

The full-back still-image path uses the downloadable gen1-back image. The
private checkout's custom full-back raster variants are not redistributed.

## What the download provides

Five sets of 151 files, matching the paths the board requests:

| Directory | Used for | Format |
| --- | --- | --- |
| `gen1/` | front still sprite, roster and log thumbnails | PNG |
| `full-back/` | own side, still (reduced-motion or failed GIF) | PNG |
| `gen1-back/` | source of the two sets above; kept for parity | PNG |
| `gen5ani/` | opponent, animated | GIF |
| `gen5ani-back/` | own side, animated | GIF |

`Sprite` in `MonsterView.tsx` builds `/pokemon/{gen5ani|gen5ani-back}/<id>.gif`
and falls back to the still PNG, then to `placeholder.svg`. The `<id>` is the
species id with everything but `[a-z0-9]` stripped, which is why the table is
keyed by ids like `mrmime` and `nidoranf`.

A skipped-by-default test (`apps/workers/src/tests/games/pokemon/sprites.test.ts`)
checks all 151 × 5 files once the directories exist, so a half-finished download
shows up as a failing test instead of a blank frame mid-battle.

Note that `apps/web/dist` grows by roughly 11 MB when the artwork is present;
that is why it stays out of version control and out of CI builds by default.
