# Upstream

Source: https://github.com/dmmulroy/anti-slop

Commit: c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b

Copied from `skills/install-anti-slop/assets/anti-slop` into `tools/oxlint/anti-slop`. The bundle matches the production `src` at this revision. The bundled Stylistic license and provenance are retained.

All 18 generic rules and `oxc/no-accumulating-spread` are enabled. Effect rules are not registered because no workspace declares Effect. ESLint, CSS checks, and existing strict type checks remain in place.

The plugin implementation is unchanged. Local additions are this provenance record, the upstream README and root license, and a private package manifest declaring ESM. The README's Stylistic provenance link uses the bundle's local directory layout. Generated Showdown code, build output, installed agent assets, and third-party vendor code are excluded. Owned adapters and generators remain checked.
