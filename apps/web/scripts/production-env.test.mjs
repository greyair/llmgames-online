import { test } from "node:test";
import assert from "node:assert/strict";
import { validateProductionEnv } from "./production-env.mjs";

test("production builds reject missing, blank, placeholder and Turnstile test keys", () => {
  for (const key of [
    undefined,
    "",
    "  ",
    "replace-with-your-turnstile-site-key",
    "1x00000000000000000000AA",
    "2x00000000000000000000AB",
    "3x00000000000000000000FF",
  ]) {
    assert.throws(
      () => validateProductionEnv({ VITE_TURNSTILE_SITE_KEY: key }),
      /Production build requires/,
    );
  }
});

test("production builds accept the public deployment key", () => {
  assert.doesNotThrow(() =>
    validateProductionEnv({ VITE_TURNSTILE_SITE_KEY: "0x4AAAA-production-widget" }),
  );
});
