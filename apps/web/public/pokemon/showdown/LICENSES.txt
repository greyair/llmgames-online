# Pokémon Showdown animation licenses

Upstream: https://github.com/smogon/pokemon-showdown-client/tree/eeaec53202425be20761198da837f5fb9b264c51

The license comments in `upstream.js` are retained from upstream. The imported standalone battle renderer methods are MIT. The move animation definitions and most effect images are CC0-1.0. The surrounding AGPL client UI is not included.

## MIT renderer

Copyright Pokémon Showdown contributors, including Guangcong Luo.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Effect images

Upstream's effect-image declaration is preserved verbatim in upstream.js. It identifies these exceptions to its CC0 declaration:

- `icicle.png`, `lightning.png`: Clint Bellanger. Triple-licensed GPLv2/GPLv3/CC-BY-SA-3.0. Sources: https://opengameart.org/content/icicle-spell and https://opengameart.org/content/lightning-shock-spell. Used here under CC-BY-SA-3.0, unchanged. License: https://creativecommons.org/licenses/by-sa/3.0/legalcode
- `rocks.png`, `rock1.png`, `rock2.png`: Pokémon Online user Gilad, GPLv3. Distributed unchanged. License: https://www.gnu.org/licenses/gpl-3.0.txt
- `bone.png`: explicitly excluded from upstream's CC0 declaration; upstream does not specify an alternative license. It is not distributed here. The bone effect uses upstream's CC0 `white feather` image (`feather.png`) with the original move timing and trajectory.

Pokémon species sprites are separate from these effect images and remain subject to the ownership notices in the repository's THIRD_PARTY_NOTICES.md.

## Local integration

The renderer adapter maps our projected sprite positions to Showdown's coordinate system. Move callbacks, effect interpolation, and easing are upstream code. Effect URLs are changed to local paths. Gen 1 definitions and their aliases are selected automatically by scripts/pokemon/vendor-showdown.mjs. No private engine state or sealed choices enter the renderer.

## OSS distribution changes

The excluded icicle, lightning, rock and Poké Ball images are not distributed
in this repository. Their effect references use the CC0 energyball.png image.
The original license comments above document upstream provenance, not a grant
of rights to excluded species artwork. Original Pokémon sprites are optional
local downloads and are ignored by Git.
