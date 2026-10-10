// Reproduce the Gen 1 subset from the published Showdown client, without rewriting move choreography.
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(new URL("../../apps/web/package.json", import.meta.url));

const ts = require("typescript");

const revision = "eeaec53202425be20761198da837f5fb9b264c51";

const base = `https://raw.githubusercontent.com/smogon/pokemon-showdown-client/${revision}/play.pokemonshowdown.com/`;

const out = new URL("../../apps/web/src/game-ui/pokemon/showdown/", import.meta.url);

const assets = new URL("../../apps/web/public/pokemon/showdown/fx/", import.meta.url);

await fs.mkdir(out, { recursive: true });

await fs.mkdir(assets, { recursive: true });

async function fetchText(path) {
  const r = await fetch(base + path);

  if (!r.ok) throw Error(`${path}: ${r.status}`);

  return r.text();
}

const source = await fetchText("src/battle-animations.ts");

const moveSource = await fetchText("src/battle-animations-moves.ts");

const parse = (s) => ts.createSourceFile("upstream.ts", s, ts.ScriptTarget.Latest, true);

const ast = parse(source),
  moveAst = parse(moveSource);

const findVar = (tree, name) =>
  tree.statements
    .flatMap((s) => (ts.isVariableStatement(s) ? [...s.declarationList.declarations] : []))
    .find((d) => d.name.getText(tree) === name);

const moves = new Map();

for (const p of findVar(moveAst, "BattleMoveAnims").initializer.properties)
  moves.set(p.name.text, p.getText(moveAst));

const aliases = new Map();

for (const s of moveAst.statements) {
  if (!ts.isExpressionStatement(s) || !ts.isBinaryExpression(s.expression)) continue;
  const e = s.expression;

  if (
    ts.isElementAccessExpression(e.left) &&
    e.left.expression.getText(moveAst) === "BattleMoveAnims"
  )
    aliases.set(e.left.argumentExpression.text, e.right.getText(moveAst));
}

const patches = new Map();

for (const s of moveAst.statements) {
  if (!ts.isExpressionStatement(s) || !ts.isBinaryExpression(s.expression)) continue;
  const e = s.expression;

  if (
    ts.isPropertyAccessExpression(e.left) &&
    ts.isElementAccessExpression(e.left.expression) &&
    e.left.expression.expression.getText(moveAst) === "BattleMoveAnims"
  ) {
    const key = e.left.expression.argumentExpression.text;
    patches.set(key, (patches.get(key) || "") + s.getText(moveAst) + "\n");
  }
}

const wanted = new Set(
  Object.keys(
    JSON.parse(
      await fs.readFile(
        new URL("../../apps/web/src/features/pokemon/gen1-moves.json", import.meta.url),
      ),
    ),
  ),
);

function refs(text) {
  return [...text.matchAll(/BattleMoveAnims(?:\.([a-z0-9]+)|\[['"]([a-z0-9]+)['"]\])/gi)].map(
    (m) => m[1] || m[2],
  );
}

for (const name of wanted) {
  for (const dep of refs((aliases.get(name) || moves.get(name) || "") + (patches.get(name) || "")))
    wanted.add(dep);
}

const absent = [...wanted].filter((k) => !moves.has(k) && !aliases.has(k));

if (absent.length) throw Error("Missing animations: " + absent.join(","));

let chosen = [...wanted].flatMap((k) => (moves.has(k) ? [moves.get(k)] : [])).join(",\n");

let aliasCode = "";

const emitted = new Set([...wanted].filter((k) => moves.has(k)));

function emitAlias(k) {
  if (emitted.has(k)) return;
  emitted.add(k);

  for (const ref of refs(aliases.get(k))) emitAlias(ref);
  aliasCode += `BattleMoveAnims[${JSON.stringify(k)}] = ${aliases.get(k)};\n`;
}

for (const k of wanted) emitAlias(k);

for (const k of wanted) aliasCode += patches.get(k) || "";

const classNode = ast.statements.find(
  (s) => ts.isClassDeclaration(s) && s.name.text === "BattleScene",
);

const methods = [
  "wait",
  "showEffect",
  "animateEffect",
  "backgroundEffect",
  "pos",
  "posT",
  "waitFor",
  "startAnimations",
  "finishAnimations",
];

const methodText = classNode.members
  .filter((m) => methods.includes(m.name?.getText(ast)))
  .map((m) => m.getText(ast))
  .join("\n");

const sprite = ast.statements
  .find((s) => ts.isClassDeclaration(s) && s.name.text === "Sprite")
  .getText(ast);

const helpers = ["BattleEffects", "BattleOtherAnims", "BattleStatusAnims"]
  .map((k) => `export const ${k} = ${findVar(ast, k).initializer.getText(ast)};`)
  .join("\n");

const easing = ast.statements
  .find((s) => s.getText(ast).startsWith("Object.assign($.easing"))
  .getText(ast);

const notices = source
  .slice(0, source.indexOf("export class BattleScene"))
  .replace(/^import .*;\n/gm, "");

let code = `${notices}\nimport $ from 'jquery';\nexport {$};\n${easing}\nexport class EffectScene {${methodText}}\n${sprite}\n${helpers}\nfor (const effect of Object.values(BattleEffects)) if(effect.url) effect.url='/pokemon/showdown/fx/'+effect.url;\n// Move definitions: CC0-1.0, Guangcong Luo and Pokemon Showdown contributors.\nexport const BattleMoveAnims={${chosen}};\n${aliasCode}`;

code = code.replaceAll("https://${Config.routes.client}/fx/", "/pokemon/showdown/fx/");

// Upstream explicitly excludes bone.png from CC0 without giving an alternative license.
code = code.replace("url: 'bone.png'", "url: 'feather.png'");

for (const file of [
  "icicle.png",
  "lightning.png",
  "rocks.png",
  "rock1.png",
  "rock2.png",
  "pokeball.png",
])
  code = code.replaceAll(`url: '${file}'`, "url: 'energyball.png'");

if (/Config\./.test(code)) throw Error("Unexpected external client configuration");

const compiled = ts.transpileModule(code, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    removeComments: false,
  },
}).outputText;

await fs.writeFile(
  new URL("upstream.js", out),
  `// Generated by scripts/pokemon/vendor-showdown.mjs. Upstream revision ${revision}.\n` +
    compiled,
);

const urls = new Set(
  [
    ...findVar(ast, "BattleEffects")
      .initializer.getText(ast)
      .matchAll(/url: '([^']+)'/g),
  ].map((m) => m[1]),
);

for (const match of (chosen + aliasCode + helpers).matchAll(/url\(['"]?([^)'"\s]+)/g)) {
  if (!match[1].includes("${")) urls.add(match[1].replace(/^.*\/fx\//, ""));
}

// Fixed concurrency, for asset download only.
for (const m of code.matchAll(/\/pokemon\/showdown\/fx\/([a-z0-9-]+\.(?:png|jpg))/g))
  urls.add(m[1]);

for (const file of [
  "bone.png",
  "icicle.png",
  "lightning.png",
  "rocks.png",
  "rock1.png",
  "rock2.png",
  "pokeball.png",
])
  urls.delete(file);

const list = [...urls];

let next = 0;

await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (next < list.length) {
      const path = list[next++];
      const r = await fetch(base + "fx/" + path);

      if (!r.ok) throw Error(`${path}: ${r.status}`);
      await fs.writeFile(new URL(path, assets), Buffer.from(await r.arrayBuffer()));
    }
  }),
);

await fs.writeFile(
  new URL("PROVENANCE.md", out),
  `# Pokemon Showdown animation subset\n\nSource: https://github.com/smogon/pokemon-showdown-client/tree/${revision}/play.pokemonshowdown.com\n\nGenerated by scripts/pokemon/vendor-showdown.mjs. Original scene effect methods, easing functions, Sprite implementation, all shared/status animations, and the 165 Gen 1 move definitions plus their dependencies. Type annotations and unused client UI are removed; move callbacks are not rewritten.\n\nMove definitions: CC0-1.0. Renderer: MIT. Preserve the licensing notice at the top of upstream.js, including asset exceptions. Effects are served locally. The surrounding client is not imported.\n`,
);

console.log(
  `Vendored ${wanted.size} move definitions/dependencies and ${urls.size} effect assets at ${revision}`,
);
