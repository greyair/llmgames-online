import { isString } from "@llmgames/game-catalog";
import type { RoomRuntime, RoomStorage } from "../../durable-objects/runtime";

/** In-memory implementation of the key/value and alarm operations used by game rooms. */
export class MemoryRoomStorage implements RoomStorage {
  private alarm: number | null = null;
  sql?: RoomStorage["sql"];
  /** Reject any object-entries write that carries this key, simulating a crash. */
  failWriteContaining: string | null = null;

  constructor(
    readonly values = new Map<string, unknown>(),
    private readonly onAlarm?: (at: number | null) => void,
    private readonly cloneValues = false,
  ) {}

  async get<T>(key: string): Promise<T | undefined> {
    // SAFETY: Tests own each storage key and its value type, matching Cloudflare's generic get<T> contract.
    return (this.cloneValues ? structuredClone(this.values.get(key)) : this.values.get(key)) as
      | T
      | undefined;
  }

  async list<T>(options: { prefix?: string } = {}): Promise<Map<string, T>> {
    const entries = [...this.values].filter(
      ([key]) => !options.prefix || key.startsWith(options.prefix),
    );

    // SAFETY: Tests own the stored key/value types; this preserves Cloudflare's caller-selected list<T> result contract and returns a fresh map.
    return new Map(entries) as Map<string, T>;
  }

  async put<T>(key: string, value: T): Promise<void>;
  async put<T>(entries: { [key: string]: T }): Promise<void>;
  async put<T>(keyOrEntries: string | { [key: string]: T }, value?: T): Promise<void> {
    if (isString(keyOrEntries)) {
      this.values.set(keyOrEntries, this.cloneValues ? structuredClone(value) : value);

      return;
    }

    if (this.failWriteContaining && Object.hasOwn(keyOrEntries, this.failWriteContaining))
      throw new Error(`storage write rejected: ${this.failWriteContaining}`);

    for (const [key, entry] of Object.entries(keyOrEntries))
      this.values.set(key, this.cloneValues ? structuredClone(entry) : entry);
  }

  transactionSync<T>(callback: () => T): T {
    return callback();
  }

  async deleteAll(): Promise<void> {
    this.values.clear();
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }

  async setAlarm(time: number | Date): Promise<void> {
    this.alarm = Number(time);
    this.onAlarm?.(this.alarm);
  }

  async deleteAlarm(): Promise<void> {
    this.alarm = null;
    this.onAlarm?.(null);
  }
}

export class MemoryRoomRuntime implements RoomRuntime {
  readonly storage: MemoryRoomStorage;
  initialized: Promise<void> = Promise.resolve();

  constructor(
    values?: Map<string, unknown>,
    onAlarm?: (at: number | null) => void,
    readonly sockets: WebSocket[] = [],
    cloneValues = false,
  ) {
    this.storage = new MemoryRoomStorage(values, onAlarm, cloneValues);
  }

  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    const result = callback();
    this.initialized = result.then(() => {});
    // The returned operation remains rejectable; attach a handler to the separate readiness observer so an intentionally rejected alarm cannot create an unhandled rejection.
    void this.initialized.catch(() => {});

    return result;
  }

  getWebSockets(): ReturnType<NonNullable<RoomRuntime["getWebSockets"]>> {
    return this.sockets;
  }
}
