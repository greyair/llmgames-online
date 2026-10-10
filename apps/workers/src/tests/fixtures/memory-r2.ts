import { createHash } from "node:crypto";
import type {
  R2Bucket,
  R2Object,
  R2ObjectBody,
  R2PutOptions,
  R2GetOptions,
  R2ListOptions,
  R2HTTPMetadata,
  R2MultipartUpload,
} from "@cloudflare/workers-types";
import { isString } from "@llmgames/game-catalog";

type R2Input = Parameters<R2Bucket["put"]>[1];

interface StoredMetadata {
  version: string;
  uploaded: Date;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

async function bytes(value: R2Input): Promise<ArrayBuffer> {
  if (value === null) return new ArrayBuffer(0);

  if (isString(value)) return new Response(value).arrayBuffer();

  if (value instanceof ArrayBuffer) return value.slice(0);

  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice().buffer;

  if ("arrayBuffer" in value) return value.arrayBuffer();
  const reader = value.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    while (true) {
      const next = await reader.read();

      if (next.done) break;
      const chunk = next.value;

      if (!(chunk instanceof Uint8Array)) throw new TypeError("R2 requires byte streams");
      chunks.push(chunk);
      length += chunk.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return joined.buffer;
}

class MemoryR2Object implements R2ObjectBody {
  readonly storageClass = "Standard";
  readonly size: number;
  readonly etag: string;
  readonly httpEtag: string;
  readonly checksums = { toJSON: () => ({}) };
  private readonly response: Response;

  constructor(
    readonly key: string,
    readonly version: string,
    data: ArrayBuffer,
    readonly uploaded: Date,
    readonly httpMetadata?: R2HTTPMetadata,
    readonly customMetadata?: Record<string, string>,
  ) {
    this.size = data.byteLength;
    this.etag = createHash("md5").update(new Uint8Array(data)).digest("hex");
    this.httpEtag = `"${this.etag}"`;
    this.response = new Response(data.slice(0));
  }

  get body() {
    return this.response.body!;
  }
  get bodyUsed() {
    return this.response.bodyUsed;
  }
  arrayBuffer() {
    return this.response.arrayBuffer();
  }
  bytes() {
    return this.response.bytes();
  }
  text() {
    return this.response.text();
  }
  blob() {
    return this.response.blob();
  }
  async json<T>(): Promise<T> {
    // SAFETY: This implements R2's caller-selected JSON<T> contract, preserving the decoded JSON unchanged.
    return JSON.parse(await this.text()) as T;
  }
  writeHttpMetadata(headers: Parameters<R2Object["writeHttpMetadata"]>[0]): void {
    const metadata = this.httpMetadata;

    if (metadata?.contentType) headers.set("content-type", metadata.contentType);

    if (metadata?.contentEncoding) headers.set("content-encoding", metadata.contentEncoding);

    if (metadata?.cacheControl) headers.set("cache-control", metadata.cacheControl);

    if (metadata?.contentDisposition)
      headers.set("content-disposition", metadata.contentDisposition);

    if (metadata?.contentLanguage) headers.set("content-language", metadata.contentLanguage);
  }
}

/** Local R2 storage retains uploaded bytes and metadata, with one fresh response body per read. */
export class MemoryR2Bucket implements R2Bucket {
  readonly objects = new Map<string, ArrayBuffer>();
  private readonly metadata = new Map<string, StoredMetadata>();

  async head(key: string): Promise<R2Object | null> {
    const data = this.objects.get(key),
      metadata = this.metadata.get(key);

    return data && metadata
      ? new MemoryR2Object(
          key,
          metadata.version,
          data,
          metadata.uploaded,
          metadata.httpMetadata,
          metadata.customMetadata,
        )
      : null;
  }

  async get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null> {
    if (options?.onlyIf || options?.range || options?.ssecKey)
      throw new Error("MemoryR2Bucket does not implement conditional, ranged, or encrypted reads");

    const data = this.objects.get(key),
      metadata = this.metadata.get(key);

    return data && metadata
      ? new MemoryR2Object(
          key,
          metadata.version,
          data,
          metadata.uploaded,
          metadata.httpMetadata,
          metadata.customMetadata,
        )
      : null;
  }

  async put(key: string, value: R2Input, options?: R2PutOptions): Promise<R2Object> {
    if (options?.onlyIf || options?.ssecKey)
      throw new Error("MemoryR2Bucket does not implement conditional or encrypted writes");
    const data = await bytes(value);
    const httpMetadata = options?.httpMetadata;

    if (httpMetadata && "get" in httpMetadata)
      throw new Error("Configure HTTP metadata using its named fields in this fixture");
    const metadata: StoredMetadata = { version: crypto.randomUUID(), uploaded: new Date() };

    if (httpMetadata) metadata.httpMetadata = httpMetadata;

    if (options?.customMetadata) metadata.customMetadata = { ...options.customMetadata };
    this.objects.set(key, data);
    this.metadata.set(key, metadata);

    return new MemoryR2Object(
      key,
      metadata.version,
      data,
      metadata.uploaded,
      metadata.httpMetadata,
      metadata.customMetadata,
    );
  }

  async delete(keys: string | string[]): Promise<void> {
    for (const key of isString(keys) ? [keys] : keys) {
      this.objects.delete(key);
      this.metadata.delete(key);
    }
  }

  async list(options?: R2ListOptions) {
    if (options?.cursor || options?.delimiter)
      throw new Error("MemoryR2Bucket does not implement cursors or delimiters");

    const keys = [...this.objects.keys()]
      .filter(
        (key) =>
          key.startsWith(options?.prefix ?? "") &&
          (!options?.startAfter || key > options.startAfter),
      )
      .sort();

    if (keys.length > (options?.limit ?? 1000))
      throw new Error("MemoryR2Bucket does not implement paginated listings");
    const selected = keys;
    const objects: R2Object[] = [];

    for (const key of selected) {
      const object = await this.head(key);

      if (object) objects.push(object);
    }

    return { objects, truncated: false as const, delimitedPrefixes: [] };
  }

  async createMultipartUpload(): Promise<R2MultipartUpload> {
    throw new Error("Multipart uploads are outside this fixture's contract");
  }
  resumeMultipartUpload(): R2MultipartUpload {
    throw new Error("Multipart uploads are outside this fixture's contract");
  }
}
