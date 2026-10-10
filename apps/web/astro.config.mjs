import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { loadEnv } from "vite";
import { validateProductionEnv } from "./scripts/production-env.mjs";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  devToolbar: { enabled: false },
  site: loadEnv("production", projectRoot, "PUBLIC_").PUBLIC_SITE_URL || "http://localhost:3000",
  // Marketing pages are prerendered to complete HTML files at build time.
  // Public React pages hydrate their controls; signed-in routes mount client-side.
  output: "static",
  srcDir: "./astro",
  publicDir: "./public",
  outDir: "./dist",
  build: {
    format: "file",
  },
  trailingSlash: "never",
  compressHTML: true,
  integrations: [
    react(),
    {
      name: "production-env",
      hooks: {
        "astro:build:start": () =>
          validateProductionEnv(loadEnv("production", projectRoot, "VITE_")),
      },
    },
    {
      name: "new-ui-previews",
      hooks: {
        "astro:config:setup": ({ command, injectRoute }) => {
          if (command === "dev") {
            injectRoute({
              pattern: "/design-preview/public/[...page]",
              entrypoint: "./astro/dev/public-preview.astro",
            });
            injectRoute({
              pattern: "/design-preview",
              entrypoint: "./astro/dev/preview-index.astro",
            });
            injectRoute({
              pattern: "/design-preview/[screen]",
              entrypoint: "./astro/dev/neutral-preview.astro",
            });
          }
        },
      },
    },
  ],
  server: {
    port: 3000,
  },
  vite: {
    // Astro also renders shared React components on the server. A shared sheet
    // avoids CSS preload URLs pointing at assets Astro already hoisted into HTML.
    build: { cssCodeSplit: false },
    envPrefix: ["PUBLIC_", "VITE_"],
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(projectRoot, "./src"),
      },
    },
    server: {
      headers: {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Content-Security-Policy": [
          "default-src 'self'",
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' data: https://challenges.cloudflare.com",
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data: https:",
          "connect-src 'self' http://localhost:6787 https://challenges.cloudflare.com",
          "frame-src https://challenges.cloudflare.com https://player.twitch.tv",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          "form-action 'self' https://accounts.google.com",
        ].join("; "),
      },
      proxy: {
        "/api/v1": {
          target: "http://localhost:6787",
          changeOrigin: true,
          ws: true,
        },
      },
    },
  },
});
