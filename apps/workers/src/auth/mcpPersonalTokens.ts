/**
 * Personal access tokens for remote MCP (PAT v1).
 *
 * OAuth stays the default way to connect. A PAT exists for the clients that
 * cannot open a browser — a Linux box, a CLI, a self-hosted runner — and it is
 * deliberately narrow: it authenticates a *user* to the MCP endpoint and nothing
 * else. It is never a session, never an agent identity, and never a substitute
 * for `agent_claim`.
 *
 * Storage rules:
 *   - the raw secret is shown once, at creation;
 *   - only an HMAC of `id:secret` is stored, so the table is useless if leaked;
 *   - the public `id` makes verification one indexed lookup;
 *   - revocation is a timestamp, so an audit trail survives.
 */
import type { D1Database } from "@cloudflare/workers-types";
import type { User } from "../types";
import { loadCurrentUser } from "./gamertags";

export const PAT_PREFIX = "llgm_pat_v1_";

/** A user keeps one token per device/tool; ten is plenty and bounds the blast radius. */
export const PAT_MAX_ACTIVE = 10;

export const PAT_DEFAULT_DAYS = 90;

export const PAT_MAX_DAYS = 365;

/** `last_used_at` is written at most once a minute per token. */
const TOUCH_INTERVAL_SECONDS = 60;

const ID_BYTES = 8;

const SECRET_BYTES = 32;

const PAT_PATTERN = /^llgm_pat_v1_([0-9a-f]{16})\.([A-Za-z0-9_-]{43})$/;

const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._\-/()]{0,39}$/u;

const encoder = new TextEncoder();

export interface PersonalTokenSummary {
  id: string;
  name: string;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
  /** Set once revoked; the row stays for the audit trail. */
  revokedAt: number | null;
  /** Purely derived for the UI, never stored. */
  expired: boolean;
}

export type CreatePersonalTokenResult =
  | { ok: true; token: string; record: PersonalTokenSummary }
  | { ok: false; code: "PAT_LIMIT_REACHED" | "PAT_INVALID_NAME" | "PAT_INVALID_EXPIRY"; message: string };

export interface VerifiedPersonalToken {
  user: User;
  tokenId: string;
  tokenName: string;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Compare digests without leaking where they first differ. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let difference = 0;

  for (let index = 0; index < a.length; index += 1)
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);

  return difference === 0;
}

async function hashToken(secret: string, id: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`pat:${id}:${value}`));

  return hex(new Uint8Array(signature));
}

function toSummary(row: {
  id: string;
  name: string;
  created_at: number;
  expires_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}, now: number): PersonalTokenSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    expired: row.expires_at <= now,
  };
}

/** Mint a token. The caller must persist the returned hash with the record. */
function mint() {
  const id = hex(crypto.getRandomValues(new Uint8Array(ID_BYTES)));
  const secret = base64Url(crypto.getRandomValues(new Uint8Array(SECRET_BYTES)));

  return { id, secret, token: `${PAT_PREFIX}${id}.${secret}` };
}

export function isPersonalToken(candidate: string): boolean {
  return candidate.startsWith(PAT_PREFIX);
}

/** The label an agent seat shows for a PAT; kept short because it travels into rooms. */
export function personalTokenClientId(name: string): string {
  const clean = name.replace(/[\p{C}]/gu, "").trim().slice(0, 24);

  return `pat:${clean || "MCP token"}`;
}

export async function listPersonalTokens(
  db: D1Database,
  userId: string,
): Promise<PersonalTokenSummary[]> {
  const now = Math.floor(Date.now() / 1000);

  const rows = await db
    .prepare(
      `SELECT id, name, created_at, expires_at, last_used_at, revoked_at
         FROM mcp_personal_tokens
        WHERE user_id = ?
        ORDER BY created_at DESC`,
    )
    .bind(userId)
    .all<{
      id: string;
      name: string;
      created_at: number;
      expires_at: number;
      last_used_at: number | null;
      revoked_at: number | null;
    }>();

  return (rows.results ?? []).map((row) => toSummary(row, now));
}

export async function createPersonalToken(
  db: D1Database,
  secret: string,
  userId: string,
  input: { name: string; expiresInDays?: number },
): Promise<CreatePersonalTokenResult> {
  const name = input.name.trim();

  if (!NAME_PATTERN.test(name))
    return {
      ok: false,
      code: "PAT_INVALID_NAME",
      message: "Give the token a name of 1–40 characters (letters, numbers, spaces, . _ - / ()).",
    };

  const days = input.expiresInDays ?? PAT_DEFAULT_DAYS;

  if (!Number.isInteger(days) || days < 1 || days > PAT_MAX_DAYS)
    return {
      ok: false,
      code: "PAT_INVALID_EXPIRY",
      message: `Choose an expiry between 1 and ${PAT_MAX_DAYS} days.`,
    };

  const now = Math.floor(Date.now() / 1000);

  const active = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM mcp_personal_tokens
        WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?`,
    )
    .bind(userId, now)
    .first<{ count: number }>();

  if ((active?.count ?? 0) >= PAT_MAX_ACTIVE)
    return {
      ok: false,
      code: "PAT_LIMIT_REACHED",
      message: `You already have ${PAT_MAX_ACTIVE} active tokens. Revoke one before creating another.`,
    };

  const minted = mint();
  const expiresAt = now + days * 24 * 60 * 60;

  await db
    .prepare(
      `INSERT INTO mcp_personal_tokens
         (id, user_id, name, token_hash, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(minted.id, userId, name, await hashToken(secret, minted.id, minted.secret), now, expiresAt)
    .run();

  return {
    ok: true,
    token: minted.token,
    record: {
      id: minted.id,
      name,
      createdAt: now,
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
      expired: false,
    },
  };
}

/** Revoke one token. Unknown ids answer false so the caller cannot probe others' tokens. */
export async function revokePersonalToken(
  db: D1Database,
  userId: string,
  id: string,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);

  const result = await db
    .prepare(
      `UPDATE mcp_personal_tokens
          SET revoked_at = ?
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .bind(now, id, userId)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

/**
 * Resolve a bearer token to its user.
 *
 * Every rejection path returns `null` — expired, revoked, unknown, wrong shape —
 * because the caller only needs "no identity". The one side effect is the
 * throttled `last_used_at` touch, which is what makes the UI show "last used".
 */
export async function verifyPersonalToken(
  db: D1Database,
  secret: string,
  candidate: string,
): Promise<VerifiedPersonalToken | null> {
  const match = PAT_PATTERN.exec(candidate);

  if (!match) return null;

  const id = match[1]!;
  const value = match[2]!;
  const now = Math.floor(Date.now() / 1000);

  const row = await db
    .prepare(
      `SELECT id, user_id, name, token_hash, expires_at, revoked_at, last_used_at
         FROM mcp_personal_tokens
        WHERE id = ? LIMIT 1`,
    )
    .bind(id)
    .first<{
      id: string;
      user_id: string;
      name: string;
      token_hash: string;
      expires_at: number;
      revoked_at: number | null;
      last_used_at: number | null;
    }>();

  if (!row || row.revoked_at !== null || row.expires_at <= now) return null;

  if (!timingSafeEqual(await hashToken(secret, id, value), row.token_hash)) return null;

  const user = await loadCurrentUser(db, row.user_id);

  if (!user) return null;

  if (row.last_used_at === null || now - row.last_used_at >= TOUCH_INTERVAL_SECONDS)
    await db
      .prepare("UPDATE mcp_personal_tokens SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL")
      .bind(now, id)
      .run();

  return { user, tokenId: row.id, tokenName: row.name };
}
