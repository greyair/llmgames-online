import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, Variables } from "./types";
import { authRoutes } from "./auth/routes";
import { apiRoutes } from "./api/routes";
import { sessionMiddleware } from "./auth/session";
import { mcpOAuthApiRoutes, mcpOAuthWellKnownRoutes } from "./auth/mcpOAuthRoutes";
import { isAllowedWebOrigin } from "./auth/webOrigins";
import { logEvent } from "./lib/observability";

// Create Hono app
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Global security headers (including OAuth HTML responses).
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (!c.res.headers.has("Content-Security-Policy")) {
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https: data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
  }

  if (new URL(c.req.url).protocol === "https:") {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
});

app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const frontendUrl = c.env.FRONTEND_URL || "http://localhost:3000";

      const allowedOrigins = (c.env.ALLOWED_ORIGINS || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);

      const frontendOrigin = new URL(frontendUrl).origin;

      if (!origin) return frontendOrigin;

      if (isAllowedWebOrigin(origin, [frontendOrigin, ...allowedOrigins])) return origin;

      return "";
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "mcp-session-id",
      "mcp-protocol-version",
      "Last-Event-ID",
    ],
    exposeHeaders: ["mcp-session-id", "mcp-protocol-version", "WWW-Authenticate"],
  }),
);

// Session middleware for all routes
app.use("*", sessionMiddleware);

// Health check
app.get("/health", (c) =>
  c.json({
    status: "ok",
    version: "v1",
    timestamp: Date.now(),
    mcp: "/api/v1/mcp",
    mcpInfo: "/api/v1/mcp/info",
    oauth: {
      authorizationServer: "/api/v1/oauth/.well-known/openid-configuration",
      protectedResource: "/api/v1/oauth/protected-resource",
      authorize: "/api/v1/oauth/authorize",
    },
  }),
);

// MCP OAuth discovery (RFC 8414 / RFC 9728) — must be at origin root
app.route("/.well-known", mcpOAuthWellKnownRoutes);

// MCP OAuth AS + DCR + consent
app.route("/api/v1/oauth", mcpOAuthApiRoutes);

// API v1 routes
app.route("/api/v1/auth", authRoutes);

app.route("/api/v1", apiRoutes);

// 404 handler
app.notFound((c) => c.json({ error: "Not Found" }, 404));

// Error handler
app.onError((_err, c) => {
  // Do not log exception objects: upstream errors can contain credentials or URLs.
  const requestId = crypto.randomUUID();
  console.error("REQUEST_FAILED", { requestId });
  logEvent("request_failed", {
    requestId,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
  });
  c.header("X-Request-ID", requestId);
  c.header("Cache-Control", "no-store");

  return c.json({ error: "Internal Server Error" }, 500);
});

// Export for Cloudflare Workers
export default app;
