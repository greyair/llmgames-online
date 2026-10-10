import { z } from "zod";
import { SQLiteD1 } from "./sqlite-d1";

const bindingsSchema = z.array(
  z.union([
    z.string(),
    z.number(),
    z.null(),
    z.bigint(),
    z.instanceof(Uint8Array),
    z.instanceof(ArrayBuffer).transform((value) => new Uint8Array(value)),
  ]),
);

/** Runs real SQL while retaining bound queries for protocol and batching assertions. */
export class RecordingSQLiteD1 extends SQLiteD1 {
  readonly calls: Array<{ sql: string; args: z.infer<typeof bindingsSchema> }> = [];
  readonly batches: Array<Parameters<SQLiteD1["batch"]>[0]> = [];

  override prepare(sql: string) {
    const statement = super.prepare(sql);
    const bind = statement.bind.bind(statement);
    statement.bind = (...values) => {
      this.calls.push({ sql, args: bindingsSchema.parse(values) });

      return bind(...values);
    };

    return statement;
  }
  override async batch<T>(statements: Parameters<SQLiteD1["batch"]>[0]) {
    this.batches.push(statements);

    return super.batch<T>(statements);
  }
}
