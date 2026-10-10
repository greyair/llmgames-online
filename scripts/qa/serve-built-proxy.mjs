import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../apps/web/dist");

const targetHost = "127.0.0.1";

const targetPort = 6787;

const port = Number(process.env.BUILT_WEB_PORT || 3001);

const auditLog = "/tmp/llmgames-live-audit-http.jsonl";

function record(request, status, contentType) {
  const pathname = new URL(request.url || "/", "http://localhost").pathname;
  fs.appendFileSync(
    auditLog,
    `${JSON.stringify({ at: new Date().toISOString(), method: request.method, pathname, status, contentType: contentType || null })}\n`,
  );
}

function targetPath(request) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  return `${url.pathname}${url.search}`;
}

const server = http.createServer((request, response) => {
  if ((request.url || "").startsWith("/api/v1/")) {
    const proxy = http.request(
      {
        hostname: targetHost,
        port: targetPort,
        method: request.method,
        path: targetPath(request),
        headers: { ...request.headers, host: `${targetHost}:${targetPort}` },
      },
      (upstream) => {
        record(request, upstream.statusCode || 502, upstream.headers["content-type"]);
        response.writeHead(upstream.statusCode || 502, upstream.headers);
        upstream.pipe(response);
      },
    );

    proxy.on("error", (error) => {
      if (!response.headersSent) response.writeHead(502);
      response.end(String(error));
    });
    request.pipe(proxy);

    return;
  }

  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  let file = path.resolve(root, `.${url.pathname}`);

  if (url.pathname === "/" || !path.extname(file))
    file = path.join(
      root,
      url.pathname === "/" ? "index.html" : `${url.pathname.replace(/\/$/, "")}.html`,
    );

  if (!file.startsWith(root + path.sep)) {
    record(request, 400, "text/plain");
    response.writeHead(400);
    response.end("Bad path");

    return;
  }

  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    record(request, 404, "text/plain");
    response.writeHead(404);
    response.end("Not found");

    return;
  }

  const mime =
    {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".ico": "image/x-icon",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".webmanifest": "application/manifest+json",
    }[path.extname(file).toLowerCase()] || "application/octet-stream";

  record(request, 200, mime);
  response.writeHead(200, { "Content-Type": mime });
  fs.createReadStream(file).pipe(response);
});

server.on("upgrade", (request, clientSocket, head) => {
  if (!(request.url || "").startsWith("/api/v1/")) {
    clientSocket.destroy();

    return;
  }

  record(request, 101, "websocket");

  const upstream = net.connect(targetPort, targetHost, () => {
    const headers = Object.entries(request.headers)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : value}`)
      .join("\r\n");

    upstream.write(
      `${request.method} ${targetPath(request)} HTTP/${request.httpVersion}\r\n${headers}\r\n\r\n`,
    );

    if (head.length) upstream.write(head);
    clientSocket.pipe(upstream).pipe(clientSocket);
  });

  upstream.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => upstream.destroy());
});

server.listen(port, "127.0.0.1", () =>
  console.log(`Built web server ready on http://localhost:${port}`),
);
