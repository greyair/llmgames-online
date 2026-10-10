import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

async function createOnce(path, contents) {
  try {
    await writeFile(new URL(path, import.meta.url), contents, { flag: "wx", mode: 0o600 });
    console.log(`Created ${path}`);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;

    console.log(`Kept existing ${path}`);
  }
}

await createOnce(
  "../apps/workers/.dev.vars",
  `ENCRYPTION_SECRET=${randomBytes(32).toString("hex")}\nGOOGLE_CLIENT_SECRET=\nTURNSTILE_SECRET_KEY=\n`,
);

await createOnce(
  "../apps/web/.env.development",
  "PUBLIC_SITE_URL=http://localhost:3000\nPUBLIC_MCP_URL=http://localhost:6787/api/v1/mcp\nVITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA\n",
);

console.log(
  "Run pnpm generate:contexto-ranks, pnpm db:migrate, then pnpm dev. See docs/deployment.md for sign-in and production setup.",
);
