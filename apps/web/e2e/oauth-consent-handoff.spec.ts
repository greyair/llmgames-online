import { expect, test, type Browser } from "@playwright/test";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { oauthCallbackHandoff } from "../../workers/src/auth/oauthHandoff";

/**
 * Guards the Gemini/Google relay handoff in a real browser.
 *
 * The consent form must answer with a document, not a 303: Chrome keeps the
 * form-submission flag across the redirect chain, so the extra hop a provider
 * relay adds is blocked by `form-action`. These tests reproduce that exact
 * chain — form POST, relay hop, final origin — with the shipping renderer.
 */

const servers: http.Server[] = [];

let consentOrigin = "";

let callback = "";

let landingOrigin = "";

function listen(server: http.Server, port = 0) {
  return new Promise<number>((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      // SAFETY: a listening TCP server reports a bound AddressInfo object, never a pipe path.
      const address = server.address() as AddressInfo | null;

      resolve(address?.port ?? port);
    });
  });
}

test.beforeAll(async () => {
  const landing = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end('<!DOCTYPE html><html><body><h1 id="connected">Connected</h1></body></html>');
  });

  const landingPort = await listen(landing);

  landingOrigin = `http://127.0.0.1:${landingPort}`;

  // The relay answers our callback with another cross-origin hop, like Google
  // sending the browser on to the Gemini origin.
  const relay = http.createServer((req, res) => {
    const query = new URL(req.url ?? "/", "http://127.0.0.1").search;

    res.writeHead(302, { Location: `${landingOrigin}/final${query}` });
    res.end();
  });

  const relayPort = await listen(relay);

  callback = `http://localhost:${relayPort}/relay?code=code-123&state=state-abc`;

  const consent = http.createServer((req, res) => {
    if (req.method === "POST") {
      req.resume();
      req.on("end", () => {
        const handoff = oauthCallbackHandoff(callback);

        res.writeHead(handoff.status, Object.fromEntries(handoff.headers));
        void handoff.text().then((body) => res.end(body));
      });

      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' http://localhost:${relayPort}`,
    });
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>consent</title></head>
<body><form method="POST" action="/consent"><button type="submit" name="decision" value="allow">Allow connection</button></form></body></html>`);
  });

  const consentPort = await listen(consent);

  consentOrigin = `http://127.0.0.1:${consentPort}`;
  servers.push(consent, relay, landing);
});

test.afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((done) => server.close(() => done()))));
});

async function approve(browser: Browser, javaScriptEnabled: boolean) {
  const context = await browser.newContext({ javaScriptEnabled });
  const page = await context.newPage();
  const violations: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error" && /Content Security Policy/i.test(message.text()))
      violations.push(message.text());
  });

  await page.goto(`${consentOrigin}/consent`);
  await page.getByRole("button", { name: "Allow connection" }).click();
  await expect(page.locator("#connected")).toBeVisible({ timeout: 10000 });

  return { page, context, violations };
}

test("a consent POST reaches the client across a provider relay hop", async ({ browser }) => {
  const { page, context, violations } = await approve(browser, true);

  expect(page.url()).toBe(`${landingOrigin}/final?code=code-123&state=state-abc`);
  expect(violations).toEqual([]);

  await context.close();
});

test("the handoff still completes when JavaScript is disabled", async ({ browser }) => {
  const { page, context, violations } = await approve(browser, false);

  expect(page.url()).toContain(`${landingOrigin}/final`);
  expect(violations).toEqual([]);

  await context.close();
});
