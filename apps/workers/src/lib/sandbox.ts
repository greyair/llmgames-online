import type { Env } from "../types";

/**
 * Live Sandbox gate (C3).
 *
 * The sandbox lets one page act as every seat in a room, which is exactly the
 * capability a production API must never expose. The gate therefore lives on
 * the server and is checked twice — when the sandbox room is created and on
 * every sandbox request — instead of being a hidden button or a client-side
 * environment flag.
 *
 * Both conditions must hold:
 *  - `ENVIRONMENT` is anything other than `production`
 *  - `SANDBOX_ENABLED` is exactly `"true"`
 *
 * A production deployment defines neither, so the routes answer 404 there.
 */
export function sandboxEnabled(
  env: Pick<Env, "ENVIRONMENT" | "SANDBOX_ENABLED">,
): boolean {
  if (env.ENVIRONMENT === "production") return false;

  return env.SANDBOX_ENABLED === "true";
}

/** Seats a sandbox room may pre-seed; the cap keeps one page from huge rosters. */
export const SANDBOX_MAX_SEATS = 8;

/** Names shown in the seat switcher; stable so a reload keeps the same roster. */
export const SANDBOX_SEAT_NAMES: readonly string[] = [
  "Sandbox 1",
  "Sandbox 2",
  "Sandbox 3",
  "Sandbox 4",
  "Sandbox 5",
  "Sandbox 6",
  "Sandbox 7",
  "Sandbox 8",
];

/** Stable per-room seat identity: the same room always produces the same ids. */
export function sandboxSeatId(index: number): string {
  return `sandbox-seat-${index + 1}`;
}
