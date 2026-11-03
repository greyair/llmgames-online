/**
 * Cross-layer events the PWA shell listens for.
 *
 * Kept out of any service module so the layout can subscribe without pulling a
 * socket implementation into every page's bundle.
 */

/** A queued move/chat line was dropped on resume because it had expired. */
export const QUEUE_DROPPED_EVENT = "llmgames:queue-dropped";
