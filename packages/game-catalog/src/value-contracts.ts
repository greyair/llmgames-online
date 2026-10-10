import { z } from "zod";

/** JSON-compatible values transported by room intents, snapshots, and tool results. */
export type WireValue = string | number | boolean | null | undefined | WireValue[] | WireObject;

export interface WireObject {
  [key: string]: WireValue;
}

/** JSON Schema tool contracts cannot contain the JavaScript-only undefined value. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const wireValueSchema: z.ZodType<WireValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.undefined(),
    z.array(wireValueSchema),
    z.record(z.string(), wireValueSchema),
  ]),
);

export const wireObjectSchema = z.record(z.string(), wireValueSchema);

export function isWireObject(value: WireValue): value is WireObject {
  return wireObjectSchema.safeParse(value).success;
}

const stringContract = z.string();

const numberContract = z.union([z.number(), z.nan(), z.literal(Infinity), z.literal(-Infinity)]);

const booleanContract = z.boolean();

const functionContract = z.function();

const objectContract = z.custom<object>(
  (value) =>
    value !== null && value === Object(value) && !functionContract.safeParse(value).success,
);

/** These predicates validate a representation while retaining the caller's existing type evidence. */
export function isString<T>(value: T): value is T & string {
  return stringContract.safeParse(value).success;
}

export function isNumber<T>(value: T): value is T & number {
  return numberContract.safeParse(value).success;
}

export function isBoolean<T>(value: T): value is T & boolean {
  return booleanContract.safeParse(value).success;
}

export function isObject<T>(value: T): value is T & object {
  return objectContract.safeParse(value).success;
}

export function isFunction<T>(value: T): value is T & ((...args: never[]) => void) {
  return functionContract.safeParse(value).success;
}

/** Optional persisted connection fields. Invalid optional fields are discarded before use. */
export const storedConnectionSchema = z.object({
  baseUrl: z.string().optional().catch(undefined),
  accessToken: z.string().optional().catch(undefined),
  roomId: z.string().optional().catch(undefined),
  roomCode: z.string().optional().catch(undefined),
  wsUrl: z.string().optional().catch(undefined),
  joinUrl: z.string().optional().catch(undefined),
  gameType: z.string().optional().catch(undefined),
  expiresAt: z.number().optional().catch(undefined),
});

export type StoredConnectionConfig = z.output<typeof storedConnectionSchema>;
