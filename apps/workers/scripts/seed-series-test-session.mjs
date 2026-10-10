// Disposable local-only browser identities for the series integration test.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

const line = readFileSync(`${root}.dev.vars`, "utf8")
  .split("\n")
  .find((value) => value.startsWith("ENCRYPTION_SECRET="));

if (!line) throw new Error("A local ENCRYPTION_SECRET in .dev.vars is required");

const raw = line.slice(line.indexOf("=") + 1).trim();

const secret = raw.startsWith('"') ? JSON.parse(raw) : raw.startsWith("'") ? raw.slice(1, -1) : raw;

const live = process.argv.includes("--live");

const directory = live ? "/tmp/llmgames-live-tests" : "/tmp/llmgames-series-tests";

mkdirSync(directory, { recursive: true, mode: 0o700 });

const now = Math.floor(Date.now() / 1000),
  exp = now + 7 * 24 * 60 * 60;

const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

const users = (live ? ["One", "Two", "Three", "Four"] : ["One", "Two"]).map((suffix) => {
  const id = `${live ? "ui-live-test" : "series-test"}-${suffix.toLowerCase()}`,
    sid = randomUUID();

  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ typ: "web_session", sub: id, sid, iat: now, exp })}`;

  return {
    id,
    sid,
    gamertag: `${live ? "UITest" : "SeriesTest"}${suffix}`,
    token: `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`,
  };
});

const sql = users
  .map(
    (
      user,
    ) => `INSERT INTO users (id, email, name, gamertag, gamertag_selected, broadcast_allowed, created_at, updated_at)
 VALUES ('${user.id}', '${user.id}@example.test', NULL, '${user.gamertag}', 1, 0, ${now}, ${now}) ON CONFLICT(id) DO NOTHING;
 INSERT INTO web_sessions (id, user_id, authenticated_at, expires_at) VALUES ('${user.sid}', '${user.id}', ${now}, ${exp});`,
  )
  .join("\n");

writeFileSync(`${directory}/seed.sql`, sql, { mode: 0o600 });

const result = spawnSync(
  "pnpm",
  [
    "exec",
    "wrangler",
    "d1",
    "execute",
    "llmgames-online-db",
    "--local",
    "--file",
    `${directory}/seed.sql`,
  ],
  { cwd: root, stdio: "pipe" },
);

if (result.status !== 0) throw new Error("Local test session seed failed");

writeFileSync(
  `${directory}/sessions.json`,
  JSON.stringify(users.map(({ id, gamertag, token }) => ({ id, gamertag, token }))),
  { mode: 0o600 },
);

console.log(`Local fixture sessions saved to ${directory}/sessions.json`);
