import { testDatabase } from "../fixtures/auth";
import type { D1Database } from "@cloudflare/workers-types";
import { describe, expect, it, vi } from "vitest";
import type { User } from "../../types";
import { isValidGamertag, selectInitialGamertag } from "../../auth/gamertags";
import * as moderation from "../../auth/usernameModeration";

function user(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "player@example.test",
    name: "Player",
    gamertag: "Playerabc12",
    gamertag_selected: 0,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

function fakeDb(initialUsers: User[]): D1Database {
  const { sqlite, db } = testDatabase();

  for (const user of initialUsers)
    sqlite
      .prepare(
        "INSERT INTO users (id,email,name,gamertag,gamertag_selected,broadcast_allowed,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        user.id,
        user.email,
        user.name,
        user.gamertag,
        user.gamertag_selected ?? 0,
        user.broadcast_allowed ?? 0,
        user.created_at,
        user.updated_at,
      );

  return db;
}

describe("gamertags", () => {
  it("saves host streaming permission with the initial username, defaulting off", async () => {
    const current = user();
    expect(
      (await selectInitialGamertag(fakeDb([current]), current, "NewName")).broadcast_allowed,
    ).toBe(0);
    expect(
      (await selectInitialGamertag(fakeDb([current]), current, "NewName", true)).broadcast_allowed,
    ).toBe(1);
  });
  it.each(["Reddy", "player_2", "ABC", "A1_b2"])(
    "accepts %s without requiring an @ prefix",
    (value) => expect(isValidGamertag(value)).toBe(true),
  );

  it.each(["@reddy", "ab", "has space", "_leading", "trailing_", "way_too_long_for_a_gamertag"])(
    "rejects %s",
    (value) => expect(isValidGamertag(value)).toBe(false),
  );

  it("allows one valid onboarding selection", async () => {
    const current = user();

    const updated = await selectInitialGamertag(fakeDb([current]), current, "  New_Player  ");

    expect(updated.gamertag).toBe("New_Player");
    expect(updated.gamertag_selected).toBe(1);
  });

  it.each(["fuckyou", "n1gger", "n_i_g_g_e_r", "xxniggerxx", "f4gg0t", "f_u_c_k", "fuuuck"])(
    "rejects abusive username %s without writing to the database",
    async (gamertag) => {
      const current = user();
      const db = fakeDb([current]);
      const prepare = vi.spyOn(db, "prepare");
      await expect(selectInitialGamertag(db, current, gamertag)).rejects.toThrow(
        "Profanity and slurs are not allowed",
      );
      expect(prepare).toHaveBeenCalledWith(expect.stringContaining("SELECT id FROM users"));
      expect(prepare.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
    },
  );

  it.each(["Scunthorpe", "Assassin", "Dickens", "ClassicPlayer"])(
    "allows innocent username %s",
    async (gamertag) => {
      const current = user();
      await expect(
        selectInitialGamertag(fakeDb([current]), current, gamertag),
      ).resolves.toMatchObject({ gamertag, gamertag_selected: 1 });
    },
  );

  it("runs moderation while the availability query is still pending", async () => {
    const current = user();
    const db = fakeDb([current]);
    const originalPrepare = db.prepare.bind(db);
    let release!: () => void;

    const pendingRead = new Promise<void>((resolve) => {
      release = resolve;
    });

    vi.spyOn(db, "prepare").mockImplementation((sql) => {
      const statement = originalPrepare(sql);

      if (sql.startsWith("SELECT id FROM users")) {
        vi.spyOn(statement, "first").mockImplementation(async () => {
          await pendingRead;

          return null;
        });
      }

      return statement;
    });
    const check = vi.spyOn(moderation, "isAbusiveUsername");

    try {
      const saving = selectInitialGamertag(db, current, "CleanPlayer");
      await Promise.resolve();
      expect(check).toHaveBeenCalledWith("CleanPlayer");
      release();
      await expect(saving).resolves.toMatchObject({ gamertag: "CleanPlayer" });
    } finally {
      release();
      check.mockRestore();
    }
  });

  it("rejects an already selected username", async () => {
    const current = user({ gamertag: "FinalName", gamertag_selected: 1 });

    await expect(selectInitialGamertag(fakeDb([current]), current, "AnotherName")).rejects.toThrow(
      "already been selected",
    );
  });

  it("treats a retry of the selected username as success", async () => {
    const current = user({ gamertag: "FinalName", gamertag_selected: 1 });

    await expect(
      selectInitialGamertag(fakeDb([current]), current, "  FinalName  "),
    ).resolves.toEqual(current);
  });

  it("treats concurrent submissions for the same username as success", async () => {
    const current = user();
    const db = fakeDb([current]);

    const [first, second] = await Promise.all([
      selectInitialGamertag(db, current, "FinalName"),
      selectInitialGamertag(db, current, "FinalName"),
    ]);

    expect(first.gamertag).toBe("FinalName");
    expect(second.gamertag).toBe("FinalName");
    expect(first.gamertag_selected).toBe(1);
    expect(second.gamertag_selected).toBe(1);
  });

  it("rejects a case-insensitive duplicate username", async () => {
    const current = user();

    const other = user({
      id: "user-2",
      email: "other@example.test",
      gamertag: "TakenName",
      gamertag_selected: 1,
    });

    await expect(
      selectInitialGamertag(fakeDb([current, other]), current, "takenname"),
    ).rejects.toThrow("already taken");
  });
});
