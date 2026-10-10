/**
 * Cloudflare Pages (and other static hosts) expect build output at repo-root
 * `dist/`. The web app builds to `apps/web/dist` — copy it up for deploy.
 */
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const src = join(root, "apps", "web", "dist");

const dest = join(root, "dist");

if (!existsSync(src)) {
  console.error(`copy-web-dist: missing ${src}. Run the Astro web build first.`);
  process.exit(1);
}

const homepagePath = join(src, "index.html");

if (!existsSync(homepagePath)) {
  console.error(`copy-web-dist: missing Astro homepage ${homepagePath}.`);
  process.exit(1);
}

const homepage = readFileSync(homepagePath, "utf8");

const libraryPath = join(src, "play.html");

const library = existsSync(libraryPath) ? readFileSync(libraryPath, "utf8") : "";

const headingText = (homepage.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "")
  .replace(/<[^>]*>/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const hasStaticLibraryContent =
  homepage.includes("<main") &&
  headingText.length > 0 &&
  homepage.includes('href="/play"') &&
  library.includes("<main") &&
  library.includes('aria-label="Game library"') &&
  [
    "connect4",
    "checkers",
    "reversi",
    "codenames",
    "poker",
    "pokemon",
    "battleship",
    "contexto",
  ].every((game) => library.includes(`href="/${game}"`) && existsSync(join(src, `${game}.html`)));

const isLegacyClientShell = homepage.includes('id="root"') || homepage.includes("/src/main.tsx");

if (!hasStaticLibraryContent || isLegacyClientShell) {
  console.error(
    "copy-web-dist: refusing to deploy incomplete output; expected an Astro homepage linked to /play and the complete game library with playable routes.",
  );
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });

cpSync(src, dest, { recursive: true });

console.log(`copy-web-dist: ${src} → ${dest}`);
