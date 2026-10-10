const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function parseOrigin(value: string): URL | null {
  try {
    const url = new URL(value);

    return url.origin === value ? url : null;
  } catch {
    return null;
  }
}

function httpPort(url: URL): string {
  return url.port || (url.protocol === "https:" ? "443" : "80");
}

function isLoopbackHttp(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
}

/** True when `origin` matches an allowed web origin, treating localhost and 127.0.0.1 as the same host. */
export function isAllowedWebOrigin(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return false;

  if (allowed.includes(origin)) return true;
  const incoming = parseOrigin(origin);

  if (!incoming || !isLoopbackHttp(incoming)) return false;

  return allowed.some((item) => {
    const allowedUrl = parseOrigin(item);

    return Boolean(
      allowedUrl && isLoopbackHttp(allowedUrl) && httpPort(allowedUrl) === httpPort(incoming),
    );
  });
}
