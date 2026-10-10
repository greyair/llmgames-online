import { roomTestEnv } from "../../fixtures/room-env";
import { z } from "zod";

import { MemoryRoomRuntime } from "../../fixtures/memory-runtime";

import { describe, expect, it } from "vitest";
import { ContextoRoom } from "../../../durable-objects/ContextoRoom";
import type { ContextoGameState } from "../../../durable-objects/types";
import { broadcastProjection } from "../../../lib/broadcastProjection";
import aliasData from "../../../lib/contextoAliases.json";
import rankData from "../../../lib/contextoRanks.json";
import targetData from "../../../lib/contextoTargets.json";
import {
  createContextoRanking,
  contextoGuessFamily,
  contextoRank,
  contextoTarget,
  CONTEXTO_TARGET_COUNT,
} from "../../../lib/contextoRanks";

class TestContextoRoom extends ContextoRoom {
  setSecret(secret: string) {
    if (this.gameState) {
      this.gameState.secret = secret;
      this.gameState.rankTable = createContextoRanking(secret)!;
    }
  }

  publicBroadcast() {
    if (!this.gameState) return null;

    return broadcastProjection(this.projectStateFor("", this.gameState), this.gameState.players);
  }

  completedRewatch() {
    return this.gameState?.status === "ended" ? this.buildRewatchView() : null;
  }
}

function createHarness() {
  const storage = new Map<string, unknown>();
  let alarmAt: number | null = null;

  const state = new MemoryRoomRuntime(storage, (at) => {
    alarmAt = at;
  });

  return new TestContextoRoom(state, roomTestEnv());
}

async function post<T>(room: ContextoRoom, path: string, body: T) {
  return room.fetch(
    new Request(`https://room.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function view(room: ContextoRoom, playerId: string) {
  const response = await room.fetch(
    new Request(`https://room.test/agent/view?playerId=${playerId}`),
  );

  return response.json<{
    state: ContextoGameState & {
      secret?: string;
      progress: Record<
        string,
        {
          guesses: Array<{ word?: string; submittedWord?: string; rank: number; masked?: boolean }>;
          lastAttempt?: {
            submittedWord: string;
            canonicalWord?: string;
            status: string;
            rank?: number;
          } | null;
          guessCount: number;
          guessesRemaining: number;
        }
      >;
      you?: { legalActions?: string[] };
    };
  }>();
}

async function startedRoom() {
  const room = createHarness();
  await post(room, "/create", { hostId: "p1", hostName: "Alex", roomCode: "SEM234" });
  expect(
    (await post(room, "/agent/join", { playerId: "p2", assignedCodename: "SwiftAnchor" })).status,
  ).toBe(200);
  expect((await post(room, "/agent/start", { playerId: "p1" })).status).toBe(200);
  room.setSecret("ocean");

  return room;
}

describe("Contexto room", () => {
  it("ships the filtered Contexto vocabulary", () => {
    expect(rankData.targets).toHaveLength(2_500);
    expect(rankData).toMatchObject({
      version: 5,
      aliasVersion: 1,
      targetVersion: 1,
      model: "word2vec-google-news-300",
      dimensions: 300,
    });
    expect(rankData.vocabulary).not.toEqual(
      expect.arrayContaining(["the", "you", "how", "who", "because", "anything", "really"]),
    );
    const aliases = Object.values(aliasData.families).flat();
    expect(rankData.vocabulary).not.toEqual(expect.arrayContaining(aliases));
  });

  it("keeps obvious related words within the first 100 ranks", () => {
    expect(contextoRank(createContextoRanking("football")!, "team")).toBeLessThanOrEqual(100);
    expect(contextoRank(createContextoRanking("garden")!, "tree")).toBeLessThanOrEqual(100);
    expect(contextoRank(createContextoRanking("river")!, "ocean")).toBeLessThanOrEqual(100);
    expect(contextoRank(createContextoRanking("doctor")!, "health")).toBeLessThanOrEqual(100);
  });

  it("keeps a broad playable target pool inside the full guess dictionary", () => {
    expect(CONTEXTO_TARGET_COUNT).toBeGreaterThanOrEqual(targetData.policy.minimumTargets);
    expect(CONTEXTO_TARGET_COUNT).toBeLessThanOrEqual(targetData.policy.maximumTargets);
    expect(
      targetData.targets.every(
        (entry) =>
          entry.guessability >= targetData.policy.guessabilityScale.minimum &&
          entry.guessability <= targetData.policy.guessabilityScale.maximum &&
          entry.rejectionRisk >= targetData.policy.rejectionRiskScale.minimum &&
          entry.rejectionRisk <= targetData.policy.rejectionRiskScale.maximum,
      ),
    ).toBe(true);
    expect(rankData.targets).toEqual(targetData.targets.map((entry) => entry.word));
    expect(new Set(rankData.targets).size).toBe(CONTEXTO_TARGET_COUNT);
    expect(rankData.targets.every((word) => rankData.vocabulary.includes(word))).toBe(true);
    expect(rankData.vocabulary).toContain("bum");
    expect(rankData.targets).toEqual(
      expect.arrayContaining([
        "doctor",
        "river",
        "football",
        "garden",
        "rainbow",
        "dragon",
        "lighthouse",
        "butterfly",
        "dolphin",
      ]),
    );
    expect(rankData.targets).not.toEqual(
      expect.arrayContaining([
        "the",
        "people",
        "children",
        "fucking",
        "bum",
        "therefore",
        "murder",
        "lesbian",
        "british",
      ]),
    );

    for (const secret of [
      contextoTarget(0)!,
      contextoTarget(Math.floor(CONTEXTO_TARGET_COUNT / 2))!,
      contextoTarget(CONTEXTO_TARGET_COUNT - 1)!,
    ]) {
      const ranking = createContextoRanking(secret);
      expect(ranking).toBeTruthy();
      expect(contextoRank(ranking!, secret)).toBe(1);
    }
  });

  it("keeps opponent words private while sharing their best ranks", async () => {
    const room = await startedRoom();
    await post(room, "/agent/action", {
      playerId: "p1",
      actionType: "guess_word",
      data: { word: "water" },
    });

    const own = await view(room, "p1");
    const rival = await view(room, "p2");
    expect(own.state.progress.p1!.guesses[0]).toMatchObject({ word: "water" });
    expect(rival.state.progress.p1!.guesses[0]).toMatchObject({ masked: true });
    expect(JSON.stringify(rival.state.progress.p1)).not.toContain("water");
    expect(rival.state.secret).toBeUndefined();
  });

  it("shares every opponent rank with game clients without sending their words", async () => {
    const room = await startedRoom();
    const guesses = rankData.vocabulary.filter((word) => word !== "ocean").slice(0, 7);

    for (const word of guesses) {
      expect(
        (
          await post(room, "/agent/action", {
            playerId: "p1",
            actionType: "guess_word",
            data: { word },
          })
        ).status,
      ).toBe(200);
    }

    const rival = await view(room, "p2");

    const rivalGuesses = z
      .array(
        z
          .object({ word: z.string().optional(), rank: z.number(), masked: z.boolean().optional() })
          .passthrough(),
      )
      .parse(rival.state.progress.p1!.guesses);

    expect(rivalGuesses).toHaveLength(7);
    expect(rivalGuesses.every((guess) => guess.masked && !("word" in guess))).toBe(true);
    expect(JSON.stringify(rival.state.progress.p1)).not.toContain(guesses[0]);
  });

  it("publishes every word and rank through the broadcast projection", async () => {
    const room = await startedRoom();
    await post(room, "/agent/action", {
      playerId: "p1",
      actionType: "guess_word",
      data: { word: "water" },
    });
    await post(room, "/agent/action", {
      playerId: "p2",
      actionType: "guess_word",
      data: { word: "river" },
    });

    const publicView = z
      .object({
        progress: z.record(
          z.string(),
          z
            .object({
              guesses: z.array(
                z
                  .object({ word: z.string(), rank: z.number(), sequence: z.number() })
                  .passthrough(),
              ),
            })
            .passthrough(),
        ),
      })
      .passthrough()
      .parse(room.publicBroadcast());

    expect(publicView.progress["seat-1"]!.guesses[0]).toMatchObject({ word: "water", sequence: 1 });
    expect(publicView.progress["seat-2"]!.guesses[0]).toMatchObject({ word: "river", sequence: 2 });
    expect(JSON.stringify(publicView)).not.toContain("rankTable");

    const playerView = await view(room, "p1");
    expect(JSON.stringify(playerView.state.progress.p2)).not.toContain("river");
  });

  it("includes every player's words in the completed browser rewatch", async () => {
    const room = await startedRoom();
    await post(room, "/agent/action", {
      playerId: "p1",
      actionType: "guess_word",
      data: { word: "water" },
    });
    await post(room, "/agent/action", {
      playerId: "p2",
      actionType: "guess_word",
      data: { word: "river" },
    });
    await post(room, "/agent/action", {
      playerId: "p1",
      actionType: "guess_word",
      data: { word: "ocean" },
    });

    const rewatch = z
      .object({
        secret: z.string(),
        progress: z.record(
          z.string(),
          z
            .object({ guesses: z.array(z.object({ word: z.string() }).passthrough()) })
            .passthrough(),
        ),
      })
      .passthrough()
      .parse(room.completedRewatch());

    expect(rewatch.secret).toBe("ocean");
    expect(rewatch.progress.p1!.guesses.map((guess) => guess.word)).toEqual(["ocean", "water"]);
    expect(rewatch.progress.p2!.guesses.map((guess) => guess.word)).toEqual(["river"]);
    expect(JSON.stringify(rewatch)).not.toContain("rankTable");

    const rival = await view(room, "p2");
    expect(JSON.stringify(rival.state.progress.p1)).not.toContain("water");
  });

  it("ends immediately at rank 1 and reveals only the secret", async () => {
    const room = await startedRoom();

    const response = await post(room, "/agent/action", {
      playerId: "p2",
      actionType: "guess_word",
      data: { word: "ocean" },
    });

    expect(response.status).toBe(200);
    const body = await response.json<{ state: ContextoGameState }>();
    expect(body.state).toMatchObject({ status: "ended", winner: "p2", secret: "ocean" });
  });

  it("uses only reviewed aliases and stores the canonical word", async () => {
    const room = await startedRoom();
    expect(
      (
        await post(room, "/agent/action", {
          playerId: "p1",
          actionType: "guess_word",
          data: { word: "dogs" },
        })
      ).status,
    ).toBe(200);

    const duplicate = await post(room, "/agent/action", {
      playerId: "p1",
      actionType: "guess_word",
      data: { word: "dog" },
    });

    expect(duplicate.status).toBe(409);
    expect(await duplicate.text()).toContain("already guessed");

    const state = await view(room, "p1");
    expect(state.state.progress.p1).toMatchObject({ guessCount: 1, guessesRemaining: 49 });
    expect(state.state.progress.p1!.guesses[0]).toMatchObject({
      word: "dog",
      submittedWord: "dogs",
    });
  });

  it("does not infer aliases from spelling", () => {
    expect(contextoGuessFamily("water")).toBe("water");
    expect(contextoGuessFamily("paper")).toBe("paper");
    expect(contextoGuessFamily("mother")).toBe("mother");
    expect(contextoGuessFamily("career")).toBe("career");
  });

  it("counts a reviewed alias as the canonical winning word", async () => {
    const room = await startedRoom();
    room.setSecret("exam");

    const response = await post(room, "/agent/action", {
      playerId: "p1",
      actionType: "guess_word",
      data: { word: "examination" },
    });

    expect(response.status).toBe(200);
    const body = await response.json<{ state: ContextoGameState }>();
    expect(body.state).toMatchObject({ status: "ended", winner: "p1", secret: "exam" });
    expect(body.state.progress.p1).toMatchObject({
      lastAttempt: {
        submittedWord: "examination",
        canonicalWord: "exam",
        status: "aliased",
        rank: 1,
      },
    });
  });

  it("rejects grammar and conversational filler without using a guess", async () => {
    const room = await startedRoom();

    for (const word of ["the", "you", "how", "anything", "really"]) {
      const response = await post(room, "/agent/action", {
        playerId: "p1",
        actionType: "guess_word",
        data: { word },
      });

      expect(response.status).toBe(422);
      expect(await response.text()).toContain("not in this game's dictionary");
    }

    const state = await view(room, "p1");
    expect(state.state.progress.p1).toMatchObject({ guessCount: 0, guessesRemaining: 50 });
    expect(state.state.progress.p1).toMatchObject({
      lastAttempt: { submittedWord: "really", status: "not_in_pool" },
    });
  });

  it("allows 50 unique accepted guesses and rejects a 51st", async () => {
    const room = await startedRoom();
    const families = new Set<string>();

    const guesses = rankData.vocabulary
      .filter((word) => {
        if (word === "ocean") return false;
        const family = contextoGuessFamily(word);

        if (families.has(family)) return false;
        families.add(family);

        return true;
      })
      .slice(0, 51);

    for (const word of guesses.slice(0, 50)) {
      expect(
        (
          await post(room, "/agent/action", {
            playerId: "p1",
            actionType: "guess_word",
            data: { word },
          })
        ).status,
      ).toBe(200);
    }

    const exhausted = await view(room, "p1");
    expect(exhausted.state.progress.p1).toMatchObject({ guessCount: 50, guessesRemaining: 0 });
    expect(exhausted.state.you?.legalActions).not.toContain("guess_word");
    expect(
      (
        await post(room, "/agent/action", {
          playerId: "p1",
          actionType: "guess_word",
          data: { word: guesses[50] },
        })
      ).status,
    ).toBe(422);
  });
});
