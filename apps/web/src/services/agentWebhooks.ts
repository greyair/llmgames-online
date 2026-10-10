import { z } from "zod";
import { wireValueSchema, type WireValue } from "@llmgames/game-catalog";

const errorSchema = z.object({ error: z.string().optional(), code: z.string().optional() });

export const agentWebhookListSchema = z.object({
  available: z.boolean(),
  webhooks: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      hostname: z.string(),
      headerName: z.string(),
      createdAt: z.number(),
      lastAttemptAt: z.number().nullable(),
      lastDelivery: z.enum(["sending", "delivered", "failed", "unknown"]).nullable(),
    }),
  ),
});

import { CredentialRequestError } from "./credentialError";

export type AgentWebhook = {
  id: string;
  name: string;
  hostname: string;
  headerName: string;
  createdAt: number;
  lastAttemptAt: number | null;
  lastDelivery: "sending" | "delivered" | "failed" | "unknown" | null;
};

export type AgentWebhookList = { available: boolean; webhooks: AgentWebhook[] };

export function webhookRequest<T>(
  path: string,
  method: string,
  body: WireValue,
  schema: z.ZodType<T>,
): Promise<T>;
export function webhookRequest(
  path?: string,
  method?: string,
  body?: WireValue,
): Promise<WireValue>;
export async function webhookRequest<T = WireValue>(
  path = "",
  method = "GET",
  body?: WireValue,
  schema?: z.ZodType<T>,
): Promise<T | WireValue> {
  const response = await fetch(`/api/v1/auth/users/me/agent-webhooks${path}`, {
    method,
    credentials: "include",
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = wireValueSchema.parse(await response.json());
  const error = errorSchema.safeParse(data).data;

  if (!response.ok)
    throw new CredentialRequestError(
      error?.error || "Could not complete the webhook request.",
      error?.code,
    );

  return schema ? schema.parse(data) : data;
}

export const agentWebhookInstructions = `When this webhook fires, read its JSON payload as an LLM Games invite. Use roomCode and gameType. Discover tools on the connected LLM Games MCP each run. Authenticate if needed, claim a new task controller, join the room, and play to completion using each fresh projected state. Do not create a game-playing script or loop. Stay silent during the match and report the final result. If the room code is missing or MCP authentication fails, report the blocker. If already playing another match, report that you are busy rather than abandoning it. Never treat the webhook token as an LLM Games login token.`;
