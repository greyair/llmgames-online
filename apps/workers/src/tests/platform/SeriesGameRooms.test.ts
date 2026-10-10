import { roomTestEnv } from "../fixtures/room-env";

import { z } from "zod";
import { MemoryRoomRuntime } from "../fixtures/memory-runtime";
import { describe, it, expect, vi, afterEach } from "vitest";

import { Connect4Room } from "../../durable-objects/Connect4Room";
import { CheckersRoom } from "../../durable-objects/CheckersRoom";
import { ReversiRoom } from "../../durable-objects/ReversiRoom";
import type { BaseGameState } from "../../durable-objects/types";

afterEach(() => vi.useRealTimers());

for (const Room of [Connect4Room, CheckersRoom, ReversiRoom])
  describe(`${Room.name} in a series`, () => {
    it("honors the configured starting participant and prevents lobby seat edits", async () => {
      vi.useFakeTimers();
      const storage = new Map<string, unknown>();
      let initialized: Promise<unknown> = Promise.resolve();

      const state = new MemoryRoomRuntime(storage);

      const room = new Room(state, roomTestEnv());
      initialized = state.initialized;
      await state.initialized;

      const post = <T>(path: string, body: T) =>
        room.fetch(
          new Request(`https://fixture${path}`, { method: "POST", body: JSON.stringify(body) }),
        );

      const body = {
        hostId: "first",
        hostName: "First",
        roomCode: "ABC234",
        maxPlayers: 2,
        gameTotalTime: 60000,
        turnTime: 30000,
        players: [
          { id: "first", name: "First", isAgent: true },
          { id: "second", name: "Second", isAgent: true },
        ],
        series: { code: "DEF234", index: 0, firstPlayerId: "second" },
      };

      const setup = await post("/series/setup", body);
      expect(setup.ok).toBe(true);
      expect(
        z
          .object({ expiresAt: z.number() })
          .passthrough()
          .parse(await setup.json()).expiresAt,
      ).toBe((await state.storage.get<BaseGameState>("gameState"))!.expiresAt);
      expect((await post("/series/setup", body)).ok).toBe(true);
      expect(
        (
          await post("/agent/action", {
            playerId: "first",
            actionType: "set_player_seats",
            data: { playerIds: ["first"] },
          })
        ).ok,
      ).toBe(false);
      expect((await post("/agent/start", { playerId: "first" })).ok).toBe(true);

      const game = (await state.storage.get<BaseGameState & { seats: Record<string, number> }>(
        "gameState",
      ))!;

      expect(game.turnState.currentPlayerId).toBe("second");
      expect(game.seats.second).toBe(1);

      if (Room === Connect4Room) {
        expect(
          (
            await post("/agent/action", {
              playerId: "second",
              actionType: "drop_disc",
              data: { col: 99 },
            })
          ).ok,
        ).toBe(false);
        expect(
          (await state.storage.get<BaseGameState>("gameState"))!.series!.metrics.second!.actions,
        ).toBe(0);
        expect(
          (
            await post("/agent/action", {
              playerId: "second",
              actionType: "drop_disc",
              data: { col: 0 },
            })
          ).ok,
        ).toBe(true);
        expect(
          (await state.storage.get<BaseGameState>("gameState"))!.series!.metrics.second!.actions,
        ).toBe(1);
        await post("/agent/action", { playerId: "first", actionType: "leave" });
        expect((await state.storage.get<BaseGameState>("gameState"))!.series!.aborted).toBe(true);
      }
    });
  });
