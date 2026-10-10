import type { Env } from "./types";

/** Retired operator entrypoint. Keep the binding compatible with older operators. */
export class BroadcastRouter {
  constructor(
    public env: Env,
    public ctx: { waitUntil(promise: Promise<unknown>): void },
  ) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method === "GET" && new URL(request.url).pathname === "/rooms")
      return Response.json({ rooms: [], next: null });

    return new Response(null, { status: 410 });
  }
}
