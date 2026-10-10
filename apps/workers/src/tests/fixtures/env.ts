import { z } from "zod";
import { isString } from "@llmgames/game-catalog";
import { createHash } from "node:crypto";
import type {
  D1Database,
  Response as WorkersResponse,
  Fetcher,
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectStub,
} from "@cloudflare/workers-types";
import type { Env } from "../../types";

function unavailable(): never {
  throw new Error("This test did not configure the requested environment binding");
}

const unavailableDatabase: D1Database = {
  prepare: unavailable,
  batch: async () => unavailable(),
  exec: async () => unavailable(),
  withSession: unavailable,
  dump: async () => unavailable(),
};

const unavailableBucket: Env["GAME_LOGS"] = {
  head: async () => unavailable(),
  get: async () => unavailable(),
  put: async () => unavailable(),
  delete: async () => unavailable(),
  list: async () => unavailable(),
  createMultipartUpload: async () => unavailable(),
  resumeMultipartUpload: unavailable,
};

class TestObjectId implements DurableObjectId {
  constructor(
    private readonly id: string,
    readonly name?: string,
  ) {}

  toString(): string {
    return this.id;
  }

  equals(other: DurableObjectId): boolean {
    return this.id === other.toString();
  }
}

const headersSchema = z.union([
  z.instanceof(Headers),
  z.array(z.tuple([z.string(), z.string()])),
  z.record(z.string(), z.string()),
]);

const initSchema = z
  .object({
    method: z.string().optional(),
    headers: headersSchema.optional(),
    body: z
      .union([
        z.string(),
        z.instanceof(ArrayBuffer),
        z.custom<ArrayBufferView>(ArrayBuffer.isView).transform((view) => {
          const bytes = new Uint8Array(view.byteLength);
          bytes.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));

          return bytes;
        }),
        z.instanceof(URLSearchParams),
        z.instanceof(FormData),
        z.instanceof(Blob),
      ])
      .nullable()
      .optional(),
    signal: z.instanceof(AbortSignal).nullable().optional(),
    redirect: z.enum(["follow", "manual", "error"]).optional(),
  })
  .optional();

class BindingHeaders extends Headers {
  getAll(name: string): string[] {
    if (name.toLowerCase() !== "set-cookie")
      throw new TypeError("Headers.getAll only supports Set-Cookie");

    return this.getSetCookie();
  }

  override forEach<This>(
    callback: (this: This, value: string, key: string, parent: BindingHeaders) => void,
    thisArg?: This,
  ): void {
    super.forEach((value, key) => callback.call(thisArg!, value, key, this));
  }
}

class NamespaceResponse extends Response {
  override get type(): "default" {
    return "default";
  }

  override get webSocket(): null {
    return null;
  }

  override clone(): NamespaceResponse {
    const copied = super.clone();

    return new NamespaceResponse(copied.body, {
      status: copied.status,
      statusText: copied.statusText,
      headers: copied.headers,
    });
  }

  private bindingHeaders?: BindingHeaders;

  override get headers(): BindingHeaders {
    this.bindingHeaders ??= new BindingHeaders(super.headers);

    return this.bindingHeaders;
  }
}

// This boundary accepts only our native HTTP response adapter. Its body implements the Fetch stream API; the SDK publishes separate DOM reader overloads.
const namespaceResponseSchema = z.custom<WorkersResponse>(
  (value) => value instanceof NamespaceResponse,
);

type RoomHandler = (name: string, request: Request) => Promise<Response>;

/** A namespace with stable opaque IDs and a configured in-process fetch handler. */
export function testNamespace(
  handler: RoomHandler = async () => unavailable(),
): DurableObjectNamespace {
  const namespace: DurableObjectNamespace = {
    newUniqueId: () => new TestObjectId(crypto.randomUUID().replaceAll("-", "").repeat(2)),
    idFromName: (name) => new TestObjectId(createHash("sha256").update(name).digest("hex"), name),
    idFromString: (id) => new TestObjectId(id),
    get(id): DurableObjectStub {
      return {
        id,
        name: id.name,
        fetch: async (input, init) => {
          if (!isString(input) && !(input instanceof URL) && !(input instanceof Request)) {
            throw new TypeError("Local namespaces require a URL or a native Request");
          }

          const response = await handler(
            id.name ?? id.toString(),
            new Request(input, initSchema.parse(init)),
          );

          if (response.webSocket)
            throw new Error("Local test fetchers do not implement WebSocket upgrades");

          return namespaceResponseSchema.parse(
            new NamespaceResponse(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
            }),
          );
        },
        connect: unavailable,
      };
    },
    getByName: (name) => namespace.get(namespace.idFromName(name)),
    jurisdiction: () => namespace,
  };

  return namespace;
}

/** All required bindings exist; unconfigured operations fail instead of silently succeeding. */
export function testEnv(overrides: Partial<Env> = {}): Env {
  const namespace = testNamespace();

  return {
    DB: unavailableDatabase,
    GAME_LOGS: unavailableBucket,
    GAME_SERIES: namespace,
    CONNECT4_ROOM: namespace,
    POKEMON_ROOM: namespace,
    CHECKERS_ROOM: namespace,
    REVERSI_ROOM: namespace,
    CODENAMES_ROOM: namespace,
    BATTLESHIP_ROOM: namespace,
    POKER_ROOM: namespace,
    CONTEXTO_ROOM: namespace,
    GOOGLE_CLIENT_ID: "",
    TURNSTILE_SITE_KEY: "",
    FRONTEND_URL: "http://localhost:3000",
    ENCRYPTION_SECRET: "",
    GOOGLE_CLIENT_SECRET: "",
    TURNSTILE_SECRET_KEY: "",
    ...overrides,
  };
}

/** Request/Response adaptation keeps the native Node test runtime compatible with Workers bindings. */
export function testFetcher(handler: (request: Request) => Promise<Response>): Fetcher {
  const namespace = testNamespace((_name, request) => handler(request));

  return namespace.get(namespace.idFromName("test-fetcher"));
}
