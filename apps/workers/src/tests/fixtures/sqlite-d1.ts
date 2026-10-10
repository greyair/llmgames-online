import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { z } from "zod";
import type {
  D1Database,
  D1DatabaseSession,
  D1PreparedStatement,
  D1Result,
} from "@cloudflare/workers-types";

const bindingSchema = z.union([
  z.string(),
  z.number(),
  z.bigint(),
  z.null(),
  z.instanceof(Uint8Array),
  z.instanceof(ArrayBuffer).transform((value) => new Uint8Array(value)),
]);

function result<T>(results: T[], changes = 0, lastRowId = 0): D1Result<T> {
  return {
    results,
    success: true,
    meta: {
      duration: 0,
      size_after: 0,
      rows_read: results.length,
      rows_written: changes,
      last_row_id: lastRowId,
      changed_db: changes > 0,
      changes,
    },
  };
}

/** D1's query interface backed by real SQLite, with real SQL and rollback behavior. */
export class SQLiteD1 implements D1Database {
  constructor(readonly sqlite: DatabaseSync) {}

  prepare(query: string): D1PreparedStatement {
    return new SQLiteStatement(this.sqlite, query);
  }

  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.sqlite.exec("BEGIN");

    try {
      const results: D1Result<T>[] = [];

      for (const statement of statements) results.push(await statement.all<T>());
      this.sqlite.exec("COMMIT");

      return results;
    } catch (cause) {
      this.sqlite.exec("ROLLBACK");
      throw cause;
    }
  }

  async exec(query: string): Promise<{ count: number; duration: number }> {
    const started = performance.now();
    this.sqlite.exec(query);

    return { count: 1, duration: performance.now() - started };
  }

  withSession(): D1DatabaseSession {
    return {
      prepare: (query) => this.prepare(query),
      batch: (statements) => this.batch(statements),
      getBookmark: () => null,
    };
  }

  async dump(): Promise<never> {
    throw new Error("SQLiteD1 does not implement the retired D1 dump API");
  }
}

class SQLiteStatement implements D1PreparedStatement {
  private values: SQLInputValue[] = [];

  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly query: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    const next = new SQLiteStatement(this.sqlite, this.query);
    next.values = values.map((value) => bindingSchema.parse(value));

    return next;
  }

  async first<T>(columnName?: string): Promise<T | null> {
    const row = this.sqlite.prepare(this.query).get(...this.values);

    if (!row) return null;

    // SAFETY: D1's generic row/column contract is selected by the caller's SQL. SQLite returns those selected columns with their native values.
    return (columnName === undefined ? row : (row[columnName] ?? null)) as T | null;
  }

  async run<T>(): Promise<D1Result<T>> {
    const applied = this.sqlite.prepare(this.query).run(...this.values);

    return result<T>([], Number(applied.changes), Number(applied.lastInsertRowid));
  }

  async all<T>(): Promise<D1Result<T>> {
    const statement = this.sqlite.prepare(this.query);
    const rows = statement.all(...this.values);
    // SAFETY: This implements D1's generic query contract: callers pair the selected SQL columns with T, and SQLite supplies those columns without changing their values.
    const typedRows = rows as T[];

    return result(typedRows);
  }

  async raw<T>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  async raw<T>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const statement = this.sqlite.prepare(this.query);
    statement.setReturnArrays(true);
    // SAFETY: setReturnArrays makes SQLite emit columns in query order. T is the tuple chosen by the D1 raw<T> caller for those columns.
    const rows = statement.all(...this.values) as T[];

    return options?.columnNames
      ? [statement.columns().map((column) => column.name), ...rows]
      : rows;
  }
}
