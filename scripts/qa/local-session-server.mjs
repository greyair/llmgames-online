import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const host = "127.0.0.1";

const port = 6788;

const secret = "ui-audit-local-only-not-a-production-secret";

const users = [
  ["10000000-0000-4000-8000-000000000001", "ui-one@example.test"],
  ["10000000-0000-4000-8000-000000000002", "ui-two@example.test"],
  ["10000000-0000-4000-8000-000000000003", "ui-three@example.test"],
  ["10000000-0000-4000-8000-000000000004", "ui-four@example.test"],
];

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sessionToken(seat) {
  const now = Math.floor(Date.now() / 1000);
  const [sub] = users[seat - 1];
  const sid = randomUUID();
  const expiresAt = now + 7 * 86400;
  execFileSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "llmgames-online-db",
      "--local",
      "--command",
      `INSERT INTO web_sessions (id,user_id,authenticated_at,expires_at) VALUES ('${sid}','${sub}',${now},${expiresAt})`,
    ],
    { cwd: new URL("../../apps/workers/", import.meta.url), stdio: ["ignore", "pipe", "pipe"] },
  );

  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    typ: "web_session",
    sub,
    sid,
    iat: now,
    exp: expiresAt,
  })}`;

  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}

const server = createServer((request, response) => {
  const url = new URL(request.url, `http://${host}:${port}`);
  const seat = Number(url.searchParams.get("seat"));

  if (url.pathname !== "/session" || !Number.isInteger(seat) || seat < 1 || seat > users.length) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Use /session?seat=1..4");

    return;
  }

  let token;

  try {
    token = sessionToken(seat);
  } catch {
    response.writeHead(503);
    response.end("Apply local migrations and seed QA users first.");

    return;
  }

  response.writeHead(302, {
    Location: `http://localhost:3001/?qaSeat=${seat}`,
    "Set-Cookie": `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`,
    "Cache-Control": "no-store",
  });
  response.end();
});

server.listen(port, host, () =>
  console.log(`Local QA session helper listening on http://${host}:${port}`),
);
