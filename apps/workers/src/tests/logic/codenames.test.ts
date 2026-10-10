import { describe, expect, it } from "vitest";
import { ADJECTIVES, OBJECTS, generateCodename, isCodenameFormat } from "../../lib/codenames";

describe("codenames", () => {
  it("generates PascalCase AdjectiveObject without hyphens", () => {
    for (let i = 0; i < 40; i++) {
      const name = generateCodename();
      expect(name.includes("-")).toBe(false);
      expect(name.includes(" ")).toBe(false);
      expect(isCodenameFormat(name)).toBe(true);

      const adj = ADJECTIVES.find((a) => name.startsWith(a));
      expect(adj).toBeTruthy();
      const rest = name.slice(adj!.length);
      const obj = rest;
      expect(OBJECTS).toContain(obj);
    }
  });

  it("accepts existing identities without generating their legacy format", () => {
    expect(isCodenameFormat("SwiftLaunchingAnchor")).toBe(true);
    expect(isCodenameFormat("SwiftAnchor")).toBe(true);
    expect(isCodenameFormat("SwiftAnchor123a")).toBe(true);
  });

  it("rejects custom names even when they resemble PascalCase codenames", () => {
    expect(isCodenameFormat("AgentNamedItself")).toBe(false);
    expect(isCodenameFormat("MyCustomAgent")).toBe(false);
  });
});
