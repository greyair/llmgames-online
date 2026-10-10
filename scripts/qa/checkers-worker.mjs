// Isolated local-only fixture for checkers-live.spec.ts. Never reads production credentials.
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const cwd = path.join(root, "apps/workers");

const folder = await mkdtemp(path.join(tmpdir(), "llmgames-checkers-"));

const config = JSON.parse(await readFile(path.join(cwd, "wrangler.json"), "utf8"));

config.main = path.join(cwd, "src/index.ts");

config.vars.ENCRYPTION_SECRET = "checkers-local-e2e-only-secret-32-characters";

for (const binding of config.d1_databases) binding.migrations_dir = path.join(cwd, "migrations");

const configPath = path.join(folder, "wrangler.json"),
  persist = path.join(folder, "state");

await writeFile(configPath, JSON.stringify(config));

await writeFile(
  path.join(folder, "seed.sql"),
  `INSERT INTO users(id,email,gamertag,gamertag_selected) VALUES ('checkers-e2e-one','one@checkers.test','CheckersOne',1),('checkers-e2e-two','two@checkers.test','CheckersTwo',1),('checkers-e2e-watcher','watch@checkers.test','CheckersWatch',1);`,
);

const args = ["--local", "--persist-to", persist, "--config", configPath];

try {
  execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "migrations", "apply", "llmgames-online-db", ...args],
    {
      cwd,
      stdio: "pipe",
    },
  );
  execFileSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "llmgames-online-db",
      ...args,
      "--file",
      path.join(folder, "seed.sql"),
    ],
    { cwd, stdio: "pipe" },
  );
} catch (error) {
  await rm(folder, { recursive: true, force: true });
  throw error;
}

console.log("Checkers QA database ready. Starting the local Worker on port 6787.");

const worker = spawn(
  "pnpm",
  ["exec", "wrangler", "dev", "--port", "6787", "--persist-to", persist, "--config", configPath],
  { cwd, stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => worker.kill(signal));

worker.on("exit", async (code) => {
  await rm(folder, { recursive: true, force: true });
  process.exitCode = code ?? 0;
});
