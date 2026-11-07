import { z } from "zod";
import { wireValueSchema, type WireValue } from "@llmgames/game-catalog";

import { CredentialRequestError } from "./credentialError";

const errorSchema = z.object({ error: z.string().optional(), code: z.string().optional() });

export const personalTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  lastUsedAt: z.number().nullable(),
  revokedAt: z.number().nullable(),
  expired: z.boolean(),
});

export const personalTokenListSchema = z.object({
  tokens: z.array(personalTokenSchema),
  maxActive: z.number(),
  defaultDays: z.number(),
  maxDays: z.number(),
});

export const personalTokenCreatedSchema = z.object({
  token: z.string(),
  record: personalTokenSchema,
});

export const personalTokenRevokedSchema = z.object({
  revoked: z.literal(true),
  id: z.string(),
});

export type PersonalToken = z.output<typeof personalTokenSchema>;

export type PersonalTokenList = z.output<typeof personalTokenListSchema>;

/**
 * Token management calls.
 *
 * Only a browser session can reach these endpoints — the server refuses any
 * request that carries a bearer credential, so a token can never mint another.
 */
export async function personalTokenRequest<T>(
  path: string,
  method: "GET" | "POST" | "DELETE",
  schema: z.ZodType<T>,
  body?: WireValue,
): Promise<T> {
  const response = await fetch(`/api/v1/auth/users/me/mcp-tokens${path}`, {
    method,
    credentials: "include",
    cache: "no-store",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = wireValueSchema.parse(await response.json());
  const failure = errorSchema.safeParse(data).data;

  if (!response.ok)
    throw new CredentialRequestError(
      failure?.error || "Could not complete the token request.",
      failure?.code,
    );

  return schema.parse(data);
}

/** What a client has to send; shown next to the created token. */
export const personalTokenUsage = "Authorization: Bearer llgm_pat_v1_…";
