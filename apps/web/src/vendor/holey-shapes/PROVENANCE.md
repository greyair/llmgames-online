Vendored from [Holey Shapes](https://github.com/skyaara/holey-shapes), version 2.0.0, on 2026-09-10. MIT license included.

Local extension: script.js and index.d.ts add the existing Doodles Petal silhouette so all 15 saved shape indices remain distinct. Its cubic contour is flattened into line segments supported by the upstream geometry parser and scaled from the previous 64-unit avatar to the upstream 420-unit viewBox.

PlayerAvatar preserves palette and shape indices and uses upstream seeded packing and a local doodle renderer with reduced-motion-aware hover animation. SVG mask and filter IDs are namespaced per React instance.

Doodle extension: doodle.js draws seeded wavy silhouettes, irregular curved cutouts, ink outlines, and a short ink shadow. geometry.js exposes its flattened contour without changing containment. The optional doodle flag in script.js and index.d.ts leaves the upstream renderer available.
