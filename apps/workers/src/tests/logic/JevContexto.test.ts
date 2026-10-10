import { testEnv } from "../fixtures/env";
import { parseJevView } from "../../agents/jev";
import { wireObjectSchema } from "@llmgames/game-catalog";
import { z } from "zod";
import { afterEach, expect, it, vi } from "vitest";
import { chooseJev, jevDecision, contextoJevBatches } from "../../agents/jev";
import { CONTEXTO_VOCABULARY_SIZE } from "../../lib/contextoRanks";

const projection = {
  gameType: "contexto",
  status: "playing",
  legalActions: ["guess_word"],
  yourProgress: { guesses: [], exhausted: false },
};

afterEach(() => vi.unstubAllGlobals());

it("covers the whole dictionary within per-question and batch bounds; strips hidden fields", () => {
  const d = jevDecision(
    parseJevView({
      ...projection,
      secret: "SECRET",
      rankTable: "HIDDEN",
      rivalProgress: [{ word: "PRIVATE" }],
    }),
  )!;

  expect(Object.keys(d.options)).toHaveLength(CONTEXTO_VOCABULARY_SIZE);
  expect(JSON.stringify(d)).not.toMatch(/SECRET|HIDDEN|PRIVATE/);
  const batches = contextoJevBatches(d);
  const questions = batches.flatMap((b) => Object.values(b));
  expect(questions).toHaveLength(37);
  expect(questions.every((q) => Object.keys(q.criteria).length <= 255)).toBe(true);
  expect(questions.flatMap((q) => Object.keys(q.criteria))).toEqual(Object.keys(d.options));

  for (const b of batches)
    expect(
      new TextEncoder().encode(
        JSON.stringify({ model: "jev-latest", state: d.state, questions: b }),
      ).length,
    ).toBeLessThanOrEqual(58000);
});

it("excludes guessed families and exhausted players", () => {
  const d = jevDecision(
    parseJevView({
      ...projection,
      yourProgress: { guesses: [{ word: "dog", rank: 100 }] },
    }),
  )!;

  expect(d.options.dog).toBeUndefined();
  expect(d.options.dogs).toBeUndefined();
  expect(
    jevDecision(parseJevView({ ...projection, yourProgress: { guesses: [], exhausted: true } })),
  ).toBeNull();
});

it("selects a finalist and reserves every request", async () => {
  const reserve = vi.fn(async () => {});
  const sizes: number[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      sizes.push(Object.keys(body.questions).length);

      return Response.json({
        answers: Object.fromEntries(
          Object.entries(body.questions).map(([id, q]) => [
            id,
            {
              type: "choice",
              choice: Object.keys(
                z.object({ criteria: wireObjectSchema }).passthrough().parse(q).criteria,
              )[0],
            },
          ]),
        ),
      });
    }),
  );
  const d = jevDecision(parseJevView(projection))!;
  const result = await chooseJev(testEnv({ TYPESAFE_API_KEY: "test" }), d, reserve);
  expect(result.actionType).toBe("guess_word");
  expect(Object.values(d.options).map((o) => o.action)).toContainEqual(result);
  expect(reserve).toHaveBeenCalledTimes(sizes.length);
  expect(sizes.at(-1)).toBe(1);
});

it("rejects an answer outside its group before requesting finalists", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ answers: { group_0: { type: "choice", choice: "invalid" } } }),
    ),
  );
  await expect(
    chooseJev(testEnv({ TYPESAFE_API_KEY: "test" }), jevDecision(parseJevView(projection))!),
  ).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("stops the tournament before another paid request when its reservation fails", async () => {
  const reserve = vi.fn(async () => {
    if (reserve.mock.calls.length === 2) throw new Error("quota");
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);

      return Response.json({
        answers: Object.fromEntries(
          Object.entries(body.questions).map(([id, q]) => [
            id,
            {
              type: "choice",
              choice: Object.keys(
                z.object({ criteria: wireObjectSchema }).passthrough().parse(q).criteria,
              )[0],
            },
          ]),
        ),
      });
    }),
  );
  await expect(
    chooseJev(
      testEnv({ TYPESAFE_API_KEY: "test" }),
      jevDecision(parseJevView(projection))!,
      reserve,
    ),
  ).rejects.toThrow("quota");
  expect(fetch).toHaveBeenCalledTimes(0);
});

it("overlaps three group requests and waits for all before the final selection", async () => {
  const releases: (() => void)[] = [];
  let finalStarted = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);

      if (body.questions.move) finalStarted = true;
      else await new Promise<void>((resolve) => releases.push(resolve));

      return Response.json({
        answers: Object.fromEntries(
          Object.entries(body.questions).map(([id, q]) => [
            id,
            {
              type: "choice",
              choice: Object.keys(
                z.object({ criteria: wireObjectSchema }).passthrough().parse(q).criteria,
              )[0],
            },
          ]),
        ),
      });
    }),
  );

  const pending = chooseJev(
    testEnv({ TYPESAFE_API_KEY: "test" }),
    jevDecision(parseJevView(projection))!,
    async () => {},
  );

  await vi.waitFor(() => expect(releases).toHaveLength(3));
  expect(finalStarted).toBe(false);
  releases[0]!();
  releases[1]!();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(finalStarted).toBe(false);
  releases[2]!();
  expect((await pending).actionType).toBe("guess_word");
  expect(finalStarted).toBe(true);
});
