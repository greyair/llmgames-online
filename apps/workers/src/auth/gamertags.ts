import type { D1Database } from "@cloudflare/workers-types";
import type { User } from "../types";
import { isAbusiveUsername } from "./usernameModeration";

export const GAMERTAG_MIN_LENGTH = 3;

export const GAMERTAG_MAX_LENGTH = 20;

export const GAMERTAG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_]{1,18}[A-Za-z0-9])?$/;

export function defaultGamertagSeed(): string {
  return `Player${crypto.randomUUID().replace(/-/g, "").slice(0, 5)}`;
}

export function isValidGamertag(value: string): boolean {
  return GAMERTAG_PATTERN.test(value);
}

function gamertagBase(value: string): string {
  const ascii = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");

  const bounded = ascii.slice(0, GAMERTAG_MAX_LENGTH).replace(/_+$/g, "");

  if (bounded.length >= GAMERTAG_MIN_LENGTH && isValidGamertag(bounded)) {
    return bounded;
  }

  return "Player";
}

async function gamertagTaken(
  db: D1Database,
  gamertag: string,
  excludeUserId?: string,
): Promise<boolean> {
  const row = excludeUserId
    ? await db
        .prepare("SELECT id FROM users WHERE lower(gamertag) = lower(?) AND id != ? LIMIT 1")
        .bind(gamertag, excludeUserId)
        .first()
    : await db
        .prepare("SELECT id FROM users WHERE lower(gamertag) = lower(?) LIMIT 1")
        .bind(gamertag)
        .first();

  return Boolean(row);
}

export async function generateAvailableGamertag(
  db: D1Database,
  preferred: string,
  excludeUserId?: string,
): Promise<string> {
  const base = gamertagBase(preferred);

  if (!(await gamertagTaken(db, base, excludeUserId))) return base;

  for (let attempt = 0; attempt < 16; attempt++) {
    const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 5);

    const prefix = base.slice(0, GAMERTAG_MAX_LENGTH - suffix.length).replace(/_+$/g, "");

    const candidate = `${prefix}${suffix}`;

    if (!(await gamertagTaken(db, candidate, excludeUserId))) return candidate;
  }

  throw new Error("Could not allocate a unique gamertag");
}

/** Backfill older accounts lazily so existing sessions continue to work. */
export async function ensureUserGamertag(db: D1Database, user: User): Promise<User> {
  if (user.gamertag && isValidGamertag(user.gamertag)) return user;

  // Do not turn a private Google name/email into a public multiplayer identity.
  const gamertag = await generateAvailableGamertag(db, defaultGamertagSeed(), user.id);

  await db
    .prepare("UPDATE users SET gamertag = ?, updated_at = unixepoch() WHERE id = ?")
    .bind(gamertag, user.id)
    .run();

  return { ...user, gamertag };
}

export async function loadCurrentUser(db: D1Database, userId: string): Promise<User | null> {
  const user = await db
    .prepare("SELECT * FROM users WHERE id = ? LIMIT 1")
    .bind(userId)
    .first<User>();

  return user ? ensureUserGamertag(db, user) : null;
}

export async function selectInitialGamertag(
  db: D1Database,
  current: User,
  requestedGamertag: string,
  broadcastAllowed = false,
): Promise<User> {
  const gamertag = requestedGamertag.trim();

  if (!isValidGamertag(gamertag)) {
    throw new Error(
      "Username must be 3–20 characters using letters, numbers, or internal underscores",
    );
  }

  if (current.gamertag_selected === 1) {
    if (current.gamertag === gamertag) return current;
    throw new Error("Username has already been selected");
  }

  // Start D1 first so the local moderation check runs while its read is pending.
  const [taken, abusive] = await Promise.all([
    gamertagTaken(db, gamertag, current.id),
    Promise.resolve().then(() => isAbusiveUsername(gamertag)),
  ]);

  if (abusive) {
    throw new Error("Please choose another username. Profanity and slurs are not allowed.");
  }

  if (taken) {
    throw new Error("That username is already taken");
  }

  let updated;

  try {
    updated = await db
      .prepare(
        "UPDATE users SET gamertag = ?, gamertag_selected = 1, broadcast_allowed = ?, updated_at = unixepoch() WHERE id = ? AND gamertag_selected = 0",
      )
      .bind(gamertag, broadcastAllowed ? 1 : 0, current.id)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (message.toLowerCase().includes("unique")) {
      throw new Error("That username is already taken");
    }

    throw new Error("Could not save username");
  }

  if ((updated.meta.changes ?? 0) !== 1) {
    const latest = await loadCurrentUser(db, current.id);

    if (latest?.gamertag_selected === 1 && latest.gamertag === gamertag) {
      return latest;
    }

    throw new Error("Username has already been selected");
  }

  const user = await loadCurrentUser(db, current.id);

  if (!user) throw new Error("User not found");

  return user;
}
