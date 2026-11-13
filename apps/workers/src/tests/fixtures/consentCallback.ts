/**
 * Reads the callback a consent POST produced.
 *
 * http(s) callbacks come back as a 200 handoff document because a form POST
 * cannot 303 through a provider relay; native schemes keep a 303 Location.
 */
export async function consentCallback(response: Response): Promise<URL> {
  const location = response.headers.get("Location");

  if (location) return new URL(location);

  const html = await response.text();
  const match = html.match(/<meta http-equiv="refresh" content="0; url=([^"]+)"/);
  const target = match?.[1];

  if (!target) throw new Error("Consent response carried no callback");

  return new URL(
    target
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"'),
  );
}
