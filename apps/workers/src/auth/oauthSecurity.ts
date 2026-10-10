import type { D1Database } from "@cloudflare/workers-types";
import { oauthError } from "./mcpOAuth";

const UNKNOWN_CLIENT = "unknown";

export async function enforceRateLimit(
  db: D1Database,
  ip: string | undefined,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<Response | null> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const key = `${bucket}:${(ip || UNKNOWN_CLIENT).slice(0, 128)}`;

  await db
    .prepare(
      `INSERT INTO oauth_rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE
         WHEN oauth_rate_limits.window_start < excluded.window_start THEN 1
         ELSE oauth_rate_limits.count + 1
       END,
       window_start = CASE
         WHEN oauth_rate_limits.window_start < excluded.window_start
           THEN excluded.window_start
         ELSE oauth_rate_limits.window_start
       END`,
    )
    .bind(key, windowStart)
    .run();

  const row = await db
    .prepare(`SELECT count FROM oauth_rate_limits WHERE key = ? AND window_start = ?`)
    .bind(key, windowStart)
    .first<{ count: number }>();

  if ((row?.count ?? 0) <= limit) return null;

  const retryAfter = Math.max(1, windowStart + windowSeconds - now);
  const response = oauthError("slow_down", "Too many OAuth requests", 429);
  response.headers.set("Retry-After", String(retryAfter));

  return response;
}

export async function cleanupExpiredOAuthRows(db: D1Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.batch([
    db.prepare(`DELETE FROM oauth_pending_requests WHERE expires_at < ?`).bind(now),
    // Retain recently redeemed codes briefly so the browser handoff page can
    // confirm that the MCP client completed its token exchange.
    db
      .prepare(
        `DELETE FROM oauth_authorization_codes WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)`,
      )
      .bind(now, now - 5 * 60),
    db
      .prepare(
        `DELETE FROM oauth_refresh_tokens WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`,
      )
      .bind(now, now - 86400),
    db.prepare(`DELETE FROM oauth_rate_limits WHERE window_start < ?`).bind(now - 86400),
    db
      .prepare(
        `DELETE FROM oauth_clients
       WHERE COALESCE(last_used_at, created_at) < ?
         AND NOT EXISTS (
           SELECT 1 FROM oauth_refresh_tokens rt
           WHERE rt.client_id = oauth_clients.client_id
             AND rt.revoked_at IS NULL AND rt.expires_at >= ?
         )`,
      )
      .bind(now - 90 * 24 * 60 * 60, now),
  ]);
}
