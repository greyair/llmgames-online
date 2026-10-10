import { describe, expect, it, vi } from "vitest";
import { migratedDb } from "../fixtures/migrated-db";
import { testEnv, testNamespace } from "../fixtures/env";
import { BroadcastRouter } from "../../broadcastRouter";

// Existing approved rows must never expose a board after streaming retires.
function service(snapshot: string | null) {
  const db = migratedDb();
  db.sqlite
    .prepare(`INSERT INTO broadcast_rooms
    (id,room_id,game_type,created_at,listed_at,expires_at,summary,snapshot,broadcast_allowed)
    VALUES ('approved','room','connect4',1,1,?,'{}',?,1)`)
    .run(Date.now() + 60000, snapshot);
  const fetchRoom = vi.fn(async () => Response.json({ status: "playing" }));

  const api = new BroadcastRouter(testEnv({ DB: db, CONNECT4_ROOM: testNamespace(fetchRoom) }), {
    waitUntil: vi.fn(),
  });

  return { api, db, fetchRoom };
}

describe("retired broadcast entrypoint", () => {
  it.each([null, '{"status":"ended"}'])(
    "hides approved live and finished rooms %s",
    async (snapshot) => {
      const { api, db, fetchRoom } = service(snapshot);

      try {
        expect(await (await api.fetch(new Request("https://internal/rooms"))).json()).toEqual({
          rooms: [],
          next: null,
        });

        for (const path of ["/rooms/approved", "/rooms/approved/stream"])
          expect((await api.fetch(new Request(`https://internal${path}`))).status).toBe(410);
        expect(
          (
            await api.fetch(
              new Request("https://internal/rooms/approved/featured", { method: "POST" }),
            )
          ).status,
        ).toBe(410);
        expect(fetchRoom).not.toHaveBeenCalled();
      } finally {
        db.sqlite.close();
      }
    },
  );
});
