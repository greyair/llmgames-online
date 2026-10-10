import { z } from "zod";

import type { MiddlewareHandler } from "hono";
import type { Env, Variables } from "../types";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const tokenSchema = z.object({ turnstileToken: z.string().min(1).max(2048) });

const verificationSchema = z.object({
  success: z.boolean(),
  "error-codes": z.array(z.string()).optional(),
});

/**
 * Hono middleware that verifies a Cloudflare Turnstile challenge token.
 *
 * The Turnstile token is read from the request body as `turnstileToken`.
 * If the `TURNSTILE_SECRET_KEY` environment variable is not set (e.g. in local development),
 * the middleware is skipped entirely so that no Turnstile widget is required locally.
 *
 * Verification flow:
 * 1. Parses the request body for `turnstileToken`.
 * 2. Posts the token (and optional client IP) to the Cloudflare siteverify API.
 * 3. Calls `next()` on success, or returns a `403` with error codes on failure.
 *
 * @returns 400 if `turnstileToken` is absent from the request body.
 * @returns 403 if Cloudflare reports the token as invalid, with `error-codes` in the body.
 * @returns 500 on unexpected errors during verification.
 */
export const verifyTurnstile: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (
  c,
  next,
) => {
  // Skip Turnstile verification in development (when secret is not configured)
  if (!c.env.TURNSTILE_SECRET_KEY) {
    const hostname = new URL(c.req.url).hostname;

    if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "[::1]") {
      return c.json({ error: "Sign-in verification is unavailable" }, 503);
    }

    await next();

    return;
  }

  try {
    const parsedToken = tokenSchema.safeParse(await c.req.json());

    if (!parsedToken.success) {
      return c.json({ error: "Missing Turnstile token" }, 400);
    }

    const token = parsedToken.data.turnstileToken;

    // Get client IP
    const clientIp =
      c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For")?.split(",")[0] || "";

    // Verify with Cloudflare
    const formData = new URLSearchParams();
    formData.append("secret", c.env.TURNSTILE_SECRET_KEY);
    formData.append("response", token);

    if (clientIp) {
      formData.append("remoteip", clientIp);
    }

    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formData,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok)
      return c.json({ error: "Sign-in verification is unavailable. Please try again." }, 502);

    const parsedResponse = verificationSchema.safeParse(await response.json());

    if (!parsedResponse.success) {
      return c.json({ error: "Invalid Turnstile verification response" }, 502);
    }

    const result = parsedResponse.data;

    if (!result.success) {
      console.error("Turnstile verification failed:", result["error-codes"]);

      return c.json(
        {
          error: "Turnstile verification failed",
          codes: result["error-codes"],
        },
        403,
      );
    }
  } catch (error) {
    console.error("Turnstile middleware error:", error);

    return c.json({ error: "Turnstile verification error" }, 500);
  }

  await next();
};
