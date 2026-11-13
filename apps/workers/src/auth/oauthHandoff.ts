import { escapeHtml } from "../lib/html";

/**
 * Answers a consent form POST with a document instead of a redirect.
 *
 * Chrome keeps the form-submission flag across an entire redirect chain and
 * applies `form-action` to every hop. Google's relay answers our 303 with a
 * further redirect to the Gemini origin, so the hop after the relay is blocked
 * even when the relay origin itself is listed; Chrome then reports the block
 * against the form's own URL, which makes it look like a same-origin submit
 * failure. Navigating from a document makes the callback an ordinary top-level
 * navigation, which `form-action` does not govern.
 *
 * The callback URL is one the authorize endpoint already matched against the
 * registered client, and it is escaped for both the markup and the script.
 */
export function oauthCallbackHandoff(callbackUrl: string): Response {
  const nonce = randomNonce();
  const href = escapeHtml(callbackUrl);
  // "<" is escaped so a URL can never close the script element.
  const scriptTarget = JSON.stringify(callbackUrl).replace(/</g, "\\u003c");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <meta http-equiv="refresh" content="0; url=${href}" />
  <title>Returning to your client · llmgames</title>
  <style>
    :root { color-scheme: light dark; --fg: #181818; --bg: #f7f7f7; --muted: #666666; --cta: #202020; --cta-text: #ffffff; --border: #dedede; }
    @media (prefers-color-scheme: dark) {
      :root { --fg: #eeeeee; --bg: #0c0c0c; --muted: #a3a3a3; --cta: #eeeeee; --cta-text: #151515; --border: #303030; }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
      background: var(--bg); color: var(--fg); line-height: 1.55;
      font-family: "Manrope", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main { width: min(420px, 100%); border: 1px solid var(--border); border-radius: 16px; padding: 28px; }
    h1 { margin: 0 0 8px; font-size: 1.125rem; }
    p { margin: 0 0 20px; color: var(--muted); font-size: 0.9375rem; }
    a { display: inline-block; padding: 10px 18px; border-radius: 999px; background: var(--cta); color: var(--cta-text); text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <main>
    <h1>Finishing the connection</h1>
    <p>Your MCP client is receiving the authorization response. If nothing happens, continue manually.</p>
    <a href="${href}" rel="noreferrer">Continue</a>
  </main>
  <script nonce="${nonce}">location.replace(${scriptTarget});</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // The callback carries the authorization code; keep it out of Referer.
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'; script-src 'nonce-${nonce}'`,
    },
  });
}

function randomNonce(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);

  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}
