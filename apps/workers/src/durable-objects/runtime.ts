import type { DurableObjectState, SqlStorageValue } from "@cloudflare/workers-types";

export interface RoomSqlRow {
  [column: string]: SqlStorageValue;
}

export interface RoomSql {
  exec<T extends RoomSqlRow>(query: string, ...bindings: SqlStorageValue[]): { toArray(): T[] };
}

/** The persistence operations used by room logic. Cloudflare's storage implements this contract. */
export interface RoomStorage {
  get<T>(key: string): Promise<T | undefined>;
  list<T>(options?: { prefix?: string }): Promise<Map<string, T>>;
  put<T>(key: string, value: T): Promise<void>;
  put<T>(entries: { [key: string]: T }): Promise<void>;
  deleteAll(): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(time: number | Date): Promise<void>;
  deleteAlarm(): Promise<void>;
  sql?: RoomSql;
  transactionSync?<T>(callback: () => T): T;
}

/** Room code depends on these methods; platform-only capabilities stay with Cloudflare. */
export interface RoomRuntime {
  storage: RoomStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  getWebSockets?: DurableObjectState["getWebSockets"];
  acceptWebSocket?: DurableObjectState["acceptWebSocket"];
  waitUntil?: DurableObjectState["waitUntil"];
}
