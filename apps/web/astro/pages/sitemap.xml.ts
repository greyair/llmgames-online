import { SITE_URL, SITEMAP_PAGE_PATHS } from "../../src/lib/siteMetadata";

export function GET() {
  const urls = ["/", ...SITEMAP_PAGE_PATHS.map((path) => `/${path}`)]
    .map((path) => `<url><loc>${new URL(path, SITE_URL).href}</loc></url>`)
    .join("");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
}
