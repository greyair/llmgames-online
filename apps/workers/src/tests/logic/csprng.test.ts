import { describe, expect, it } from "vitest";
import { randomId, randomInt, sha256Hex, shuffleInPlace } from "../../lib/csprng";

describe("cryptographic randomness helpers", () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid randomInt bound %s",
    (bound) => {
      expect(() => randomInt(bound)).toThrow("maxExclusive must be positive integer");
    },
  );

  it("always returns zero for a one-value range", () => {
    expect(randomInt(1)).toBe(0);
  });

  it("returns values inside the requested range", () => {
    for (let i = 0; i < 100; i++) {
      const value = randomInt(7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
    }
  });

  it("shuffles in place without losing or duplicating values", () => {
    const input = [1, 2, 3, 4, 5, 6];
    const result = shuffleInPlace(input);

    expect(result).toBe(input);
    expect([...result].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("creates the standard SHA-256 digest and UUID shape", async () => {
    await expect(sha256Hex("hello")).resolves.toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    expect(randomId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
