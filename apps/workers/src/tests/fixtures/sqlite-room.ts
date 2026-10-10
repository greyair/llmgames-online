import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { SqlStorageValue } from "@cloudflare/workers-types";
import type { RoomSql, RoomSqlRow } from "../../durable-objects/runtime";

const rowSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.null(), z.instanceof(ArrayBuffer)]),
);

/** Executes the same SQLite history queries as a room's Durable Object storage. */
export class SqliteRoomSql implements RoomSql {
  constructor(readonly database = new DatabaseSync(":memory:")) {}

  exec<T extends RoomSqlRow>(query: string, ...bindings: SqlStorageValue[]) {
    const nativeBindings = bindings.map((value) =>
      value instanceof ArrayBuffer ? new Uint8Array(value) : value,
    );

    const rows = this.database
      .prepare(query)
      .all(...nativeBindings)
      .map((row) => {
        const parsed = Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            value instanceof Uint8Array
              ? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
              : value,
          ]),
        );

        return rowSchema.parse(parsed);
      });

    return {
      toArray(): T[] {
        // SAFETY: SQLite rows were checked for supported column values; callers supply each query's result contract, matching Cloudflare's generic exec<T> API.
        return structuredClone(rows) as T[];
      },
    };
  }
}
