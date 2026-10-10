import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./types";
import { BroadcastRouter } from "./broadcastRouter";

/** Cloudflare binding adapter for the independently testable broadcast router. */
export class BroadcastService extends WorkerEntrypoint<Env> {
  fetch(request: Request): Promise<Response> {
    return new BroadcastRouter(this.env, this.ctx).fetch(request);
  }
}
