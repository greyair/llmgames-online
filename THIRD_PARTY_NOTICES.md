# Third-party notices

## Holey Shapes

LLM Games uses the shape catalog from
[Holey Shapes](https://github.com/skyaara/holey-shapes).

MIT License

Copyright (c) 2026 Holey Shapes contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Pokémon Gen 1 battles

The server uses @pkmn/sim and @pkmn/randoms 0.10.11, extracted from Pokémon Showdown. Source: https://github.com/pkmn/ps and https://github.com/smogon/pokemon-showdown.

The MIT License (MIT)

Copyright (c) 2011-2026 Guangcong Luo and other contributors http://pokemonshowdown.com/

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The bundled standalone animation renderer is extracted from Pokémon Showdown
client revision `eeaec53202425be20761198da837f5fb9b264c51`. The extracted renderer
is MIT, move definitions and the included effect images are CC0-1.0. The AGPL
client UI is not included. Local adapters retain upstream notices.
See `apps/web/src/game-ui/pokemon/showdown/LICENSES.md` and `PROVENANCE.md`.

Original Pokémon species artwork is excluded from this source distribution.
The original game remains playable with an MIT-licensed generic placeholder.
The optional `pnpm assets:pokemon` command fetches separate third-party artwork
for your local deployment, subject to its owners' rights. It is not covered by
this project's MIT license and remains ignored by Git.

Upstream's differently licensed icicle, lightning, and rock images and its
Poké Ball image are omitted. Their animation references use the CC0 energy-ball
image. The unlicensed bone image uses the CC0 feather image.

## Geist typeface

The bundled Geist font is distributed under SIL OFL 1.1. Its license is at
`apps/web/public/fonts/geist-OFL.txt`. Fontsource dependencies retain their
own font licenses in their packages.

## Anti-slop lint plugin

The vendored plugin is MIT. Its upstream revision and notice are retained at
`tools/oxlint/anti-slop/UPSTREAM.md` and `LICENSE`. The vendored stylistic helper
has its notice at `tools/oxlint/anti-slop/vendor/eslint-stylistic/LICENSE`.

Other npm dependencies retain their respective licenses. This project's MIT
license applies to original project code and artwork, not third-party brands,
game names, fonts, or separately licensed dependencies and assets.

## Contexto embedding data

The original semantic rankings derive from Google's word2vec-google-news-300
vectors through https://github.com/qdrant/contexto at revision
`e183ad8c059089dbb18415a27dd221ea8e78714a`. That repository does not include
a license for its data. The generated embedding file is excluded from Git
and from this MIT source distribution. The original project generator is
included to reproduce the data locally; it does not grant redistribution or
usage rights to the upstream dataset. Curated target and alias files are
original project data.
