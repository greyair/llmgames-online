import { z } from "zod";

import type { WireValue } from "@llmgames/game-catalog";

/** Decision models the host can seat as a Jev-style opponent. */
export type DecisionProviderId = "typesafe" | "clef";

/** One typed option set, matching the System One / Clef question shape. */
export type DecisionCriterion =
  | string
  | number
  | boolean
  | null
  | DecisionCriterion[]
  | { [key: string]: DecisionCriterion };

export interface DecisionQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, DecisionCriterion>;
}

export interface DecisionProviderRequest {
  state: object;
  questions: Record<string, DecisionQuestion>;
}

/** Minimal Workers AI surface used by the Clef provider. */
export interface WorkersAiBinding {
  run(
    model: string,
    inputs: DecisionProviderRequest & { model: string },
  ): Promise<WireValue>;
}

/** The configuration a provider needs, kept structural so `Env` can build on it. */
export interface DecisionEnv {
  TYPESAFE_API_KEY?: string;
  AI?: WorkersAiBinding;
  CLEF_MODEL?: string;
}

/**
 * The only part of a provider reply this server acts on.
 *
 * Probabilities and extra metadata are parsed away at the transport boundary:
 * game code may only read a choice that was one of the offered options.
 */
export const decisionAnswerSchema = z.object({
  answers: z.record(
    z.string(),
    z.object({ type: z.literal("choice"), choice: z.string() }),
  ),
});

export type DecisionAnswers = z.output<typeof decisionAnswerSchema>["answers"];

/** Transport failure. `retryable` mirrors the status classes Jev already retried. */
export class DecisionProviderError extends Error {
  constructor(readonly retryable = false) {
    super("Decision provider is unavailable");
  }
}

const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";

/** Providers that are configured for this deployment, in display order. */
export function availableDecisionProviders(env: DecisionEnv): DecisionProviderId[] {
  const providers: DecisionProviderId[] = [];

  if (env.TYPESAFE_API_KEY) providers.push("typesafe");

  if (env.AI) providers.push("clef");

  return providers;
}

/** The Workers AI model selector; anything unexpected falls back to full Clef. */
function clefModel(value: string | undefined): "clef" | "clef-flash" {
  return value === "clef-flash" ? "clef-flash" : "clef";
}

/**
 * One decision request, dispatched by provider.
 *
 * Both providers speak the same state/questions shape, which is why the game
 * adapter keeps one code path: only the transport and model selector differ.
 * Quota is reserved after the size check and before the request leaves, and the
 * reply is validated here so no caller ever sees a provider-shaped object.
 */
export async function requestDecision(
  env: DecisionEnv,
  provider: DecisionProviderId,
  request: DecisionProviderRequest,
  maxBytes: number,
  beforeRequest?: () => Promise<void>,
): Promise<DecisionAnswers> {
  const body =
    provider === "clef"
      ? { model: clefModel(env.CLEF_MODEL), state: request.state, questions: request.questions }
      : { model: "jev-latest", state: request.state, questions: request.questions };

  if (new TextEncoder().encode(JSON.stringify(body)).length > maxBytes)
    throw new DecisionProviderError(false);

  // Reserve quota only for a request that is actually about to be sent.
  await beforeRequest?.();

  let raw: unknown;

  if (provider === "clef") {
    if (!env.AI) throw new DecisionProviderError(false);

    try {
      raw = await env.AI.run("@cf/cloudflare/clef", body);
    } catch {
      throw new DecisionProviderError(true);
    }
  } else {
    if (!env.TYPESAFE_API_KEY) throw new DecisionProviderError(false);
    let response: Response;

    try {
      response = await fetch(TYPESAFE_ENDPOINT, {
        method: "POST",
        // Workers rejects "error"; manual redirects fail the response.ok check below.
        redirect: "manual",
        headers: {
          Authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new DecisionProviderError(true);
    }

    if (!response.ok)
      throw new DecisionProviderError([429, 500, 502, 503, 504, 529].includes(response.status));

    try {
      raw = await response.json();
    } catch {
      throw new DecisionProviderError(false);
    }
  }

  const parsed = decisionAnswerSchema.safeParse(raw);

  if (!parsed.success) throw new DecisionProviderError(false);

  return parsed.data.answers;
}
