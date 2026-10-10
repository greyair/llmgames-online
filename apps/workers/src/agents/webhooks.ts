import { z } from "zod";
import type { Env } from "../types";
import { decryptJevKey, encryptJevKey } from "./jevCredentials";

// Global Workers fetch supplies the public-network boundary. Never use a service
// or VPC binding here. Reject literal IPs, local names and redirects as well.
export function webhookUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname;

    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      url.port ||
      host.length > 253 ||
      !host.includes(".") ||
      !/^[a-z0-9.-]+$/.test(host) ||
      host.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
      !/\.[a-z]{2,}$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion|home|lan)$/.test(host) ||
      host.endsWith(".home.arpa") ||
      host === "metadata.google.internal"
    )
      return null;

    return url.href;
  } catch {
    return null;
  }
}

const headerName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9-]+$/)
  .refine((value) => {
    const lower = value.toLowerCase();

    return (
      ![
        "host",
        "cookie",
        "set-cookie",
        "content-type",
        "content-length",
        "connection",
        "transfer-encoding",
        "upgrade",
        "expect",
        "trailer",
        "te",
        "origin",
        "referer",
        "accept-encoding",
        "forwarded",
      ].includes(lower) && !/^(?:cf-|sec-|proxy-|x-forwarded-)/.test(lower)
    );
  });

export const webhookInput = z
  .object({
    name: z.string().trim().min(1).max(60),
    url: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => webhookUrl(value) !== null)
      .optional(),
    headerName,
    headerValue: z
      .string()
      .trim()
      .max(2048)
      .regex(/^[\x20-\x7e]*$/)
      .optional(),
  })
  .strict();

export type WebhookSecret = { url: string; headerValue: string };

export type WebhookRow = {
  id: string;
  owner_id: string;
  name: string;
  hostname: string;
  header_name: string;
  ciphertext: string;
  nonce: string;
  key_version: string;
  created_at: number;
  last_attempt_at: number | null;
  last_delivery: string | null;
};

export function encryptWebhook(env: Env, ownerId: string, id: string, secret: WebhookSecret) {
  return encryptJevKey(env, `agent-webhook:${ownerId}`, id, JSON.stringify(secret));
}

export async function decryptWebhook(env: Env, row: WebhookRow): Promise<WebhookSecret> {
  return JSON.parse(await decryptJevKey(env, `agent-webhook:${row.owner_id}`, row));
}

export function webhookMetadata(row: WebhookRow) {
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    headerName: row.header_name,
    createdAt: row.created_at,
    lastAttemptAt: row.last_attempt_at,
    lastDelivery: row.last_delivery,
  };
}
