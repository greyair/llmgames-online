import type { Env } from "../../types";
import { testEnv } from "./env";
import { migratedDb } from "./migrated-db";
import { MemoryR2Bucket } from "./memory-r2";

/** Game rooms can complete their real archive and directory cleanup against local services. */
export function roomTestEnv(overrides: Partial<Env> = {}) {
  return testEnv({ DB: migratedDb(), GAME_LOGS: new MemoryR2Bucket(), ...overrides });
}
