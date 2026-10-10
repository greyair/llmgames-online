import { z } from "zod";
import { userSchema } from "../fixtures/auth";
import { SQLiteD1 } from "../fixtures/sqlite-d1";
import { testEnv } from "../fixtures/env";
import { URL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { authRoutes } from "../../auth/routes";
import type { Env, Variables } from "../../types";

function harness(authenticated = true) {
  const sqlite = new DatabaseSync(":memory:");
  const directory = new URL("../../../migrations/", import.meta.url);

  for (const file of readdirSync(directory)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync(new URL(file, directory), "utf8"));
  sqlite.exec(
    "INSERT INTO users (id,email,gamertag) VALUES ('host','host@example.test','InitialHost'), ('guest','guest@example.test','InitialGuest')",
  );

  const env = testEnv({ DB: new SQLiteD1(sqlite) });

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    if (authenticated)
      c.set(
        "user",
        userSchema.parse(sqlite.prepare("SELECT * FROM users WHERE id = 'host'").get()),
      );
    await next();
  });
  app.route("/", authRoutes);

  return {
    sqlite,
    env,
    request: (path: string, method: string, body: import("@llmgames/game-catalog").WireValue) =>
      app.request(
        path,
        { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
        env,
      ),
  };
}

describe("retired host broadcast permission", () => {
  it("ignores a legacy signup request to enable streaming", async () => {
    const h = harness();

    try {
      expect(
        (
          await h.request("/users/me/onboarding", "POST", {
            username: "PlayerName",
            broadcastAllowed: true,
          })
        ).status,
      ).toBe(200);
      expect(
        h.sqlite.prepare("SELECT broadcast_allowed FROM users WHERE id = 'host'").get()
          ?.broadcast_allowed,
      ).toBe(0);
    } finally {
      h.sqlite.close();
    }
  });
  it("clears old permission and cannot enable it through the legacy API", async () => {
    const h = harness();

    try {
      h.sqlite.exec("UPDATE users SET broadcast_allowed = 1 WHERE id = 'host'");

      const response = await h.request("/users/me/broadcast", "PATCH", {
        allowed: true,
        userId: "guest",
      });

      expect(response.status).toBe(200);
      expect(
        z.object({ user: z.object({ broadcast_allowed: z.number() }) }).parse(await response.json())
          .user.broadcast_allowed,
      ).toBe(0);
      expect(
        h.sqlite.prepare("SELECT broadcast_allowed FROM users WHERE id = 'host'").get()
          ?.broadcast_allowed,
      ).toBe(0);
      expect(
        h.sqlite.prepare("SELECT broadcast_allowed FROM users WHERE id = 'guest'").get()
          ?.broadcast_allowed,
      ).toBe(0);
    } finally {
      h.sqlite.close();
    }
  });
  it("still requires authentication and validates legacy input", async () => {
    const anonymous = harness(false);
    const h = harness();

    try {
      expect(
        (await anonymous.request("/users/me/broadcast", "PATCH", { allowed: true })).status,
      ).toBe(401);
      expect((await h.request("/users/me/broadcast", "PATCH", { allowed: "true" })).status).toBe(
        400,
      );
    } finally {
      anonymous.sqlite.close();
      h.sqlite.close();
    }
  });
});
