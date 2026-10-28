/**
 * Structured, credential-free diagnostics for Cloudflare-native logging.
 *
 * Events go to Workers Logs / Logpush as one JSON line per event so operators
 * can filter by `event` without any extra infrastructure. Values stay primitive
 * and sensitive field names are dropped before writing.
 */

import { isString } from "@llmgames/game-catalog";

/** Field names that must never reach a log line. */
const SENSITIVE_FIELD = /token|secret|password|credential|authorization|cookie|agentid|email/i;

const MAX_STRING_LENGTH = 120;

export type DiagnosticValue = string | number | boolean | null | undefined;

export type DiagnosticFields = Record<string, DiagnosticValue>;

/**
 * Emit one structured diagnostic event.
 *
 * @param {string} event - Stable machine-readable name, e.g. `archive_failed`.
 * @param {DiagnosticFields} [fields] - Primitive context; never secrets.
 */
export function logEvent(event: string, fields: DiagnosticFields = {}): void {
  const safe: DiagnosticFields = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || SENSITIVE_FIELD.test(key)) continue;

    safe[key] = isString(value) ? value.slice(0, MAX_STRING_LENGTH) : value;
  }

  console.log(JSON.stringify({ event, at: Date.now(), ...safe }));
}
