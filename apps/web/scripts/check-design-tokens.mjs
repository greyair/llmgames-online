import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import postcss from "postcss";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

const files = globSync("src/**/*.css", { cwd: root });

const componentFiles = globSync("src/**/*.{ts,tsx}", { cwd: root });

const tokenFile = "src/design/tokens.css";

const definitions = new Set();

const failures = [];

const parsed = files.map((file) => ({
  file,
  css: postcss.parse(readFileSync(resolve(root, file), "utf8"), { from: file }),
}));

for (const { css } of parsed)
  css.walkDecls((d) => {
    if (d.prop.startsWith("--")) definitions.add(d.prop);
  });

const spacing =
  /^(?:gap|row-gap|column-gap|(?:padding|margin)(?:-(?:top|bottom|left|right|inline|block|inline-start|inline-end|block-start|block-end))?)$/;

const positiveLength = /(?<![\w.-])(?:\d*\.)?\d+(?:px|rem)\b/;

for (const { file, css } of parsed) {
  if (file === tokenFile) continue;
  css.walkDecls((d) => {
    const fail = (message) =>
      failures.push(`${file}:${d.source.start.line} ${message}: ${d.prop}: ${d.value}`);

    if (/var\(--[^,)]*\(/.test(d.value)) fail("Malformed token reference");

    if (
      /^--(?:type|space|leading|palette|stroke)-/.test(d.prop) ||
      ["--font-ui", "--font-code"].includes(d.prop)
    )
      fail("Define shared tokens only in tokens.css");

    if (
      (d.prop === "font" || d.prop === "font-size" || spacing.test(d.prop)) &&
      positiveLength.test(d.value)
    )
      fail("Use a type or spacing token");

    if (
      !d.value.includes("url(") &&
      (/#[a-f\d]{3,8}\b/i.test(d.value) || /\brgba?\(/.test(d.value))
    )
      fail("Define colors in tokens.css");

    if (d.prop === "line-height" && /^(?:\d*\.)?\d+(?:px|rem)?$/.test(d.value))
      fail("Use a leading token");

    for (const match of d.value.matchAll(
      /var\((--(?:type|space|leading|palette|stroke|font|radius)-[\w-]+)/g,
    )) {
      if (!definitions.has(match[1])) fail(`Undefined token ${match[1]}`);
    }
  });
}

const inlineSpacing =
  /\b(?:gap|rowGap|columnGap|margin(?:Top|Right|Bottom|Left|Inline|Block)?|padding(?:Top|Right|Bottom|Left|Inline|Block)?)\s*:\s*(?:\d*\.)?\d+\b/g;

for (const file of componentFiles) {
  const source = readFileSync(resolve(root, file), "utf8");

  for (const style of source.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
    for (const match of style[1].matchAll(inlineSpacing)) {
      const line = source.slice(0, (style.index ?? 0) + match.index).split("\n").length;
      failures.push(
        `${file}:${line} Move numeric inline spacing to CSS and use a spacing token: ${match[0]}`,
      );
    }
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Design tokens checked in ${files.length} stylesheets and ${componentFiles.length} component files.`,
  );
