/**
 * Cryptographically secure randomness for games (Workers Web Crypto).
 * Prefer this over Math.random() for decks, dice, and secret placement.
 */

/** Uniform integer in [0, maxExclusive). Uses rejection sampling to avoid modulo bias. */
export function randomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error(`randomInt: maxExclusive must be positive integer, got ${maxExclusive}`);
  }

  if (maxExclusive === 1) return 0;

  // Largest multiple of maxExclusive that fits in uint32
  const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
  const buf = new Uint32Array(1);
  let x: number;

  do {
    crypto.getRandomValues(buf);
    x = buf[0]!;
  } while (x >= limit);

  return x % maxExclusive;
}

/** Fisher–Yates shuffle in place with CSPRNG. */
export function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }

  return arr;
}

/** Hex-encode bytes. */
function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  return Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 hex of a UTF-8 string (for post-hand shoe commitments / audit). */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return bytesToHex(digest);
}

/** Random UUID using Web Crypto. */
export function randomId(): string {
  return crypto.randomUUID();
}
