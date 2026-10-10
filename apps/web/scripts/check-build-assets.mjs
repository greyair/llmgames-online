import { existsSync, globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist/", import.meta.url));

const references = new Set();

const missing = new Set();

for (const file of globSync("{**/*.html,_astro/**/*.js}", { cwd: root })) {
  const source = readFileSync(resolve(root, file), "utf8");

  for (const match of source.matchAll(/["'](\/?_astro\/[^"'?#\s]+\.(?:css|js))["']/g)) {
    const asset = match[1]?.replace(/^\//, "");

    if (!asset) continue;
    references.add(asset);

    if (!existsSync(resolve(root, asset))) missing.add(asset);
  }
}

if (!references.size) {
  console.error("No built JavaScript or CSS asset references found.");
  process.exitCode = 1;
} else if (missing.size) {
  console.error(
    "Built pages or preload maps reference missing assets:\n" + [...missing].join("\n"),
  );
  process.exitCode = 1;
} else {
  console.log(`Verified ${references.size} built JavaScript and CSS assets.`);
}
