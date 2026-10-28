import { z } from "zod";
import { wireValueSchema, type WireValue, isNumber, isString } from "@llmgames/game-catalog";

/**
 * Authentication service for Google OAuth
 */
// API base path - Astro's Vite dev server proxies requests in development.
const API_BASE = "/api/v1";

export interface User {
  id: string;
  email: string;
  name: string | null;
  gamertag: string;
  gamertag_selected?: number;
  broadcast_allowed?: number;
}

export interface AgentActivity {
  codename: string;
  environmentLabel: string;
  createdAt: number;
  lastUsedAt: number | null;
  hasRoomHistory: boolean;
  isActive: boolean;
}

export interface AgentGameLogParticipant {
  ref: string;
  isYours: boolean;
  isAgent: boolean;
  codename: string | null;
  environmentLabel: string | null;
  displayName: string;
  ownerGamertag: string | null;
}

export interface AgentGameLogSummary {
  id: string;
  gameType: string;
  startedAt: number;
  endedAt: number;
  endReason: string;
  winner: string | null;
  eventCount: number;
  sizeBytes: number;
  participants: AgentGameLogParticipant[];
  featured?: {
    watchUrl: string;
    recording: boolean;
  };
}

export interface AgentGameLogEvent {
  seq: number;
  at: number;
  type: string;
  summary?: WireValue;
}

export interface AgentGameLogDocument {
  version: 1;
  gameId: string;
  gameType: string;
  startedAt: number;
  endedAt: number;
  endReason: string;
  winner: string | null;
  participants: Omit<AgentGameLogParticipant, "isYours">[];
  events: AgentGameLogEvent[];
  rewatch: WireValue;
}

const authPayloadSchema = z
  .object({
    user: wireValueSchema.optional(),
    error: wireValueSchema.optional(),
    agents: wireValueSchema.optional(),
    deletedCount: wireValueSchema.optional(),
    preservedActiveCount: wireValueSchema.optional(),
    games: wireValueSchema.optional(),
    nextCursor: wireValueSchema.optional(),
    authUrl: wireValueSchema.optional(),
    challengeId: wireValueSchema.optional(),
    redirectUrl: wireValueSchema.optional(),
  })
  .nullable()
  .catch(null);

const objectValue = authPayloadSchema.parse;

type AuthPayload = z.output<typeof authPayloadSchema>;

function stringField(value: AuthPayload, key: keyof NonNullable<AuthPayload>): string | undefined {
  const result = z.string().optional().safeParse(value?.[key]);

  return result.success ? result.data : undefined;
}

function errorMessage(value: AuthPayload, fallback: string): string {
  return stringField(value, "error") || fallback;
}

const userSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  name: z.string().nullable(),
  gamertag: z.string(),
  gamertag_selected: z.number().optional(),
  broadcast_allowed: z.number().optional(),
});

function isUser<T>(value: T): value is T & User {
  return userSchema.safeParse(value).success;
}

const activitySchema = z.object({
  codename: z.string().min(1),
  environmentLabel: z.string().min(1),
  createdAt: z.number(),
  lastUsedAt: z.number().nullable(),
  hasRoomHistory: z.boolean(),
  isActive: z.boolean(),
});

function isAgentActivity<T>(value: T): value is T & AgentActivity {
  return activitySchema.safeParse(value).success;
}

const participantSchema = z.object({
  ref: z.string(),
  isYours: z.boolean(),
  isAgent: z.boolean(),
  codename: z.string().nullable(),
  environmentLabel: z.string().nullable(),
  displayName: z.string(),
  ownerGamertag: z.string().nullable(),
});

const summarySchema = z.object({
  id: z.string().min(1),
  gameType: z.string().min(1),
  startedAt: z.number(),
  endedAt: z.number(),
  endReason: z.string(),
  winner: z.string().nullable(),
  eventCount: z.number(),
  sizeBytes: z.number(),
  participants: z.array(participantSchema),
  featured: z.object({ watchUrl: z.string(), recording: z.boolean() }).optional(),
});

function isAgentGameLogSummary<T>(value: T): value is T & AgentGameLogSummary {
  return summarySchema.safeParse(value).success;
}

const documentSchema = z.object({
  version: z.literal(1),
  gameId: z.string().min(1),
  gameType: z.string().min(1),
  startedAt: z.number(),
  endedAt: z.number(),
  endReason: z.string(),
  winner: z.string().nullable(),
  participants: z.array(participantSchema.omit({ isYours: true })),
  events: z.array(
    z.object({
      seq: z.number(),
      at: z.number(),
      type: z.string(),
      summary: wireValueSchema.optional(),
    }),
  ),
  rewatch: z.object({ frames: z.array(wireValueSchema) }),
});

function isAgentGameLogDocument<T>(value: T): value is T & AgentGameLogDocument {
  return documentSchema.safeParse(value).success;
}

function normalizeUser(user: User): User {
  return {
    ...user,
    gamertag: isString(user.gamertag) ? user.gamertag : "",
  };
}

export async function completeOnboarding(username: string): Promise<User> {
  const response = await fetch(`${API_BASE}/auth/users/me/onboarding`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ username }),
  });

  const data: unknown = await response.json();
  const payload = objectValue(data);
  const user = payload?.["user"];

  if (!response.ok || !isUser(user)) {
    throw new Error(errorMessage(objectValue(data), "Could not save username"));
  }

  const saved = normalizeUser(user);
  rememberCurrentUser(saved);

  return saved;
}

const SESSION_KEY = "llmgames-session";

let currentUserRequest: Promise<User | null> | null = null;

let currentUserValue: User | null | undefined;

function announceSession(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("llmgames:session"));
}

function readStoredUser(): User | null | undefined {
  if (typeof localStorage === "undefined") return undefined;

  try {
    const raw = localStorage.getItem(SESSION_KEY);

    if (!raw) return undefined;
    const payload = objectValue(JSON.parse(raw));

    if (!payload || !Object.prototype.hasOwnProperty.call(payload, "user")) return undefined;
    const user = payload?.["user"];

    if (user === null) return null;

    return isUser(user) ? normalizeUser(user) : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredUser(user: User | null): void {
  if (typeof localStorage === "undefined") return;

  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ user }));
  } catch {
    /* Session still works in memory if storage is blocked. */
  }
}

function setSession(user: User | null): User | null {
  currentUserValue = user;
  writeStoredUser(user);
  announceSession();

  return user;
}

export function peekCurrentUser(): User | null | undefined {
  return currentUserValue;
}

export function rememberCurrentUser(user: User | null): void {
  currentUserRequest = Promise.resolve(user);
  setSession(user);
}

export function forgetCurrentUser(): void {
  currentUserRequest = null;
  currentUserValue = undefined;
  const stored = readStoredUser();

  if (stored !== undefined) currentUserValue = stored;
  announceSession();
}

if (typeof localStorage !== "undefined") {
  const stored = readStoredUser();

  if (stored !== undefined) currentUserValue = stored;
}

/**
 * Get current authenticated user
 */
export async function getCurrentUser(): Promise<User | null> {
  if (!currentUserRequest) {
    currentUserRequest = (async () => {
      const response = await fetch(`${API_BASE}/auth/users/me`, {
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error("Could not verify your session");
      }

      const data: unknown = await response.json().catch(() => null);
      const payload = objectValue(data);

      if (!payload || !Object.prototype.hasOwnProperty.call(payload, "user")) {
        throw new Error("Could not verify your session");
      }

      const user = payload?.["user"];

      if (user === null) return setSession(null);

      if (!isUser(user)) throw new Error("Could not verify your session");

      return setSession(normalizeUser(user));
    })();
  }

  return currentUserRequest;
}

/** Recheck the server instead of returning the cached account lookup. */
export function refreshCurrentUser(): Promise<User | null> {
  currentUserRequest = null;

  return getCurrentUser();
}

/**
 * Get recent MCP agent seat activity owned by the current player.
 */
export async function getAgentActivity(): Promise<AgentActivity[]> {
  const response = await fetch(`${API_BASE}/auth/users/me/agents`, {
    credentials: "include",
  });

  const data: unknown = await response.json();

  if (!response.ok) {
    throw new Error(errorMessage(objectValue(data), "Could not load agent activity"));
  }

  const agents = objectValue(data)?.["agents"];

  if (!Array.isArray(agents) || !agents.every(isAgentActivity)) {
    throw new Error("Agent activity response has an invalid shape");
  }

  return agents;
}

export async function deleteAgentIdentity(codename: string): Promise<void> {
  const response = await fetch(`${API_BASE}/auth/users/me/agents/${encodeURIComponent(codename)}`, {
    method: "DELETE",
    credentials: "include",
  });

  const data: unknown = await response.json();

  if (!response.ok) {
    throw new Error(errorMessage(objectValue(data), "Could not delete agent identity"));
  }
}

export async function deleteAllAgentIdentities() {
  const response = await fetch(`${API_BASE}/auth/users/me/agents`, {
    method: "DELETE",
    credentials: "include",
  });

  const data: unknown = await response.json();

  if (!response.ok) {
    throw new Error(errorMessage(objectValue(data), "Could not delete agent identities"));
  }

  const payload = objectValue(data);
  const deletedCount = payload?.["deletedCount"];
  const preservedActiveCount = payload?.["preservedActiveCount"];

  if (!isNumber(deletedCount) || !isNumber(preservedActiveCount)) {
    throw new Error("Delete all response has an invalid shape");
  }

  return { deletedCount, preservedActiveCount };
}

export async function getAgentGameLogs(before?: string) {
  const query = before == null ? "" : `?before=${encodeURIComponent(before)}`;

  const response = await fetch(`${API_BASE}/auth/users/me/game-logs${query}`, {
    credentials: "include",
  });

  const data: unknown = await response.json();

  if (!response.ok) throw new Error(errorMessage(objectValue(data), "Could not load game logs"));
  const payload = objectValue(data);
  const games = payload?.["games"];
  const nextCursor = payload?.["nextCursor"];

  if (
    !Array.isArray(games) ||
    !games.every(isAgentGameLogSummary) ||
    (nextCursor !== undefined && nextCursor !== null && !isString(nextCursor))
  ) {
    throw new Error("Game log response has an invalid shape");
  }

  return { games, nextCursor: isString(nextCursor) ? nextCursor : null };
}

export async function getAgentGameLog(gameId: string): Promise<AgentGameLogDocument> {
  const response = await fetch(
    `${API_BASE}/auth/users/me/game-logs/${encodeURIComponent(gameId)}`,
    { credentials: "include" },
  );

  const data: unknown = await response.json();

  if (!response.ok) throw new Error(errorMessage(objectValue(data), "Could not load game log"));

  if (!isAgentGameLogDocument(data)) {
    throw new Error("Game log document has an invalid shape");
  }

  return data;
}

/**
 * Initiate Google OAuth login
 * @param turnstileToken - Token from Turnstile widget (optional in development)
 */
export async function login(
  turnstileToken?: string,
  returnTo?: string,
  provider: "google" | "github" = "google",
): Promise<void> {
  const response = await fetch(`${API_BASE}/auth/oauth/${provider}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ turnstileToken: turnstileToken || "", returnTo }),
  });

  if (!response.ok) {
    const error: unknown = await response.json();
    throw new Error(errorMessage(objectValue(error), "Login failed"));
  }

  const data: unknown = await response.json();
  const authUrl = stringField(objectValue(data), "authUrl");

  if (!authUrl) throw new Error("Login response is missing authUrl");
  // Redirect to Google OAuth
  window.location.href = authUrl;
}

/**
 * Logout current user
 */
export async function logout(returnTo = "/", allBrowsers = false): Promise<void> {
  const response = await fetch(
    `${API_BASE}/auth/sessions/${allBrowsers ? "logout-all" : "logout"}`,
    {
      method: "POST",
      credentials: "include",
    },
  );

  if (!response.ok) throw new Error("Could not sign out. Please try again.");
  rememberCurrentUser(null);
  const { go } = await import("@/lib/navigate");
  go(returnTo);
}

export async function requestEmailCode(
  email: string,
  turnstileToken?: string,
  returnTo?: string,
): Promise<string> {
  const response = await fetch(`${API_BASE}/auth/email/request`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, turnstileToken, returnTo }),
  });

  const data: unknown = await response.json();

  if (!response.ok)
    throw new Error(
      errorMessage(objectValue(data), "Unable to send a code. Please try again shortly."),
    );
  const id = stringField(objectValue(data), "challengeId");

  if (!id) throw new Error("Unable to start email sign-in");

  return id;
}

export async function verifyEmailCode(challengeId: string, code: string): Promise<string> {
  const response = await fetch(`${API_BASE}/auth/email/verify`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challengeId, code }),
  });

  const data: unknown = await response.json();

  if (!response.ok) throw new Error(errorMessage(objectValue(data), "Unable to verify this code"));
  const redirectUrl = stringField(objectValue(data), "redirectUrl");

  if (!redirectUrl) throw new Error("Login response is missing its destination");

  return redirectUrl;
}
