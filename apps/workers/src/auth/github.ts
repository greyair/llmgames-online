import type { Context } from "hono";
import { sign, verify } from "hono/jwt";
import { z } from "zod";
import { isString } from "@llmgames/game-catalog";
import type { Env, User, Variables } from "../types";
import { browserLoginDestination, loginReturnDestination, sanitizeReturnTo } from "./google";
import { createSession, setSessionCookie } from "./session";
import { defaultGamertagSeed, generateAvailableGamertag } from "./gamertags";

type AuthContext = Context<{ Bindings: Env; Variables: Variables }>;

const ttl = 600;

const stateName = (state: string, secure: boolean) => (secure ? "__Host-" : "") + "github_oauth_state_" + state;

const cookie = (name: string, value: string, secure: boolean, age: number) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? "; Secure" : ""}`;

export async function githubStart(c: AuthContext) {
  if (!c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET)
    return c.json({ error: "GitHub sign-in is unavailable" }, 503);
  const body = await c.req.json<{ returnTo?: string }>();
  const url = new URL(c.req.url);

  const state = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const token = await sign(
    {
      typ: "github_oauth_state",
      verifier,
      state,
      returnTo: sanitizeReturnTo(isString(body.returnTo) ? body.returnTo : null, url.origin),
      exp: Math.floor(Date.now() / 1000) + ttl,
    },
    c.env.ENCRYPTION_SECRET,
    "HS256",
  );

  const auth = new URL("https://github.com/login/oauth/authorize");
  auth.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID);
  auth.searchParams.set(
    "redirect_uri",
    new URL("/api/v1/auth/oauth/github/callback", url).toString(),
  );
  auth.searchParams.set("scope", "user:email");
  auth.searchParams.set("state", state);
  auth.searchParams.set("code_challenge", challenge);
  auth.searchParams.set("code_challenge_method", "S256");

  return c.json({ authUrl: auth.toString() }, 200, {
    "Set-Cookie": cookie(stateName(state, url.protocol === "https:"), token, url.protocol === "https:", ttl),
  });
}

export async function githubCallback(c: AuthContext) {
  const url = new URL(c.req.url);
  const { state, code } = c.req.query();

  let returnTo: string | null = null;
  let verifier = "";
  let verifiedState = false;
  const secure = url.protocol === "https:";
  const name = state && /^[a-f0-9]{64}$/.test(state) ? stateName(state, secure) : null;

  const fail = (reason: string) => {
    const destination = new URL("/login", c.env.FRONTEND_URL);
    destination.searchParams.set("error", reason);

    if (returnTo) destination.searchParams.set("return_to", returnTo);
    const response = c.redirect(destination.toString());

    if (verifiedState && name) response.headers.append("Set-Cookie", cookie(name, "", secure, 0));

    return response;
  };

  if (!state || !name) return fail("missing_params");
  const values = (c.req.header("Cookie") ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(name + "="));

  if (values.length === 0) return fail("missing_state_cookie");

  if (values.length !== 1) return fail("invalid_state");
  const value = values[0]!.slice(name.length + 1);

  try {
    const payload = z
      .object({
        typ: z.literal("github_oauth_state"),
        state: z.string(),
        verifier: z.string().regex(/^[a-f0-9]{64}$/),
        returnTo: z.string().nullable(),
      })
      .parse(await verify(value, c.env.ENCRYPTION_SECRET, "HS256"));

    if (payload.state !== state) return fail("invalid_state");
    returnTo = sanitizeReturnTo(payload.returnTo, url.origin);
    verifier = payload.verifier;
    verifiedState = true;
  } catch {
    return fail("invalid_state");
  }

  if (!code) return fail("authorization_denied");

  if (!c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET) return fail("github_unavailable");

  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: c.env.GITHUB_CLIENT_ID,
        client_secret: c.env.GITHUB_CLIENT_SECRET,
        code,
        code_verifier: verifier,
        redirect_uri: new URL("/api/v1/auth/oauth/github/callback", url).toString(),
      }),
    });

    if (!tokenResponse.ok) return fail("token_exchange_failed");

    const token = z
      .object({ access_token: z.string().min(1) })
      .parse(await tokenResponse.json()).access_token;

    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "llmgames-online",
    };

    const [profileResponse, emailsResponse] = await Promise.all([
      fetch("https://api.github.com/user", { headers }),
      fetch("https://api.github.com/user/emails", { headers }),
    ]);

    if (!profileResponse.ok || !emailsResponse.ok) return fail("userinfo_failed");

    const profile = z
      .object({
        id: z.number().int().positive(),
        name: z.string().nullable().optional(),
        login: z.string(),
      })
      .parse(await profileResponse.json());

    const emails = z
      .array(
        z.object({
          email: z.string().email().max(254),
          primary: z.boolean(),
          verified: z.boolean(),
        }),
      )
      .parse(await emailsResponse.json());

    const email = emails
      .find((e) => e.primary && e.verified)
      ?.email.trim()
      .toLowerCase();

    if (!email) return fail("unverified_email");
    const githubId = String(profile.id);

    let user = await c.env.DB.prepare(
      "SELECT users.* FROM users JOIN github_identities ON users.id = github_identities.user_id WHERE github_id = ?",
    )
      .bind(githubId)
      .first<User>();

    if (!user) {
      const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?")
        .bind(email)
        .first();

      if (existing) return fail("github_email_conflict");
      const id = crypto.randomUUID();
      const now = Math.floor(Date.now() / 1000);
      const gamertag = await generateAvailableGamertag(c.env.DB, defaultGamertagSeed());
      const displayName = (profile.name || profile.login).slice(0, 200);
      await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO users (id, email, name, gamertag, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ).bind(id, email, displayName, gamertag, now, now),
        c.env.DB.prepare("INSERT INTO github_identities (github_id, user_id) VALUES (?, ?)").bind(
          githubId,
          id,
        ),
      ]);
      user = {
        id,
        email,
        name: displayName,
        gamertag,
        gamertag_selected: 0,
        created_at: now,
        updated_at: now,
      };
    }

    const session = await createSession(c, user);

    const destination = returnTo
      ? loginReturnDestination(returnTo, url.origin, c.env.FRONTEND_URL)
      : browserLoginDestination(c.env.FRONTEND_URL, user);

    const response = c.redirect(destination);
    setSessionCookie(response, session, { secure: url.protocol === "https:" });
    response.headers.append("Set-Cookie", cookie(name, "", url.protocol === "https:", 0));

    return response;
  } catch {
    return fail("callback_failed");
  }
}
