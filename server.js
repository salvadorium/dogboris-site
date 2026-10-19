"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 3000);
const INDEX_PATH = path.join(__dirname, "index.html");
const MENU = Object.freeze([
  { id: "10:00", time: "10:00" },
  { id: "12:00", time: "12:00" },
  { id: "14:00", time: "14:00" },
  { id: "16:00", time: "16:00" },
  { id: "18:00", time: "18:00" }
].map(Object.freeze));

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4096) {
        reject(new Error("Request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new SyntaxError("Request body must be valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

async function handleRequest(request, response) {
  const pathname = new URL(request.url, "http://localhost").pathname;

  if (request.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    fs.readFile(INDEX_PATH, (error, content) => {
      if (error) {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Unable to read index.html");
        return;
      }
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(content);
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/menu") {
    sendJson(response, 200, { items: MENU });
    return;
  }

  if (request.method === "POST" && pathname === "/api/selection") {
    let payload;
    try {
      payload = await readJson(request);
    } catch (error) {
      sendJson(response, error instanceof SyntaxError ? 400 : 413, {
        error: error.message
      });
      return;
    }

    if (!payload || typeof payload.id !== "string" || !MENU.some((slot) => slot.id === payload.id)) {
      sendJson(response, 400, { error: "Unknown walk time" });
      return;
    }

    sendJson(response, 200, {
      ok: true,
      message: `Выбрано время ${payload.id}. Это локальное демо, запись не сохраняется.`
    });
    return;
  }

  if (request.method === "POST" && pathname === "/api/reset") {
    sendJson(response, 200, {
      ok: true,
      message: "Демо-выбор сброшен."
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/status") {
    sendJson(response, 200, {
      ok: true,
      time: new Date().toISOString()
    });
    return;
  }

  response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ error: "Not found" }));
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error("PORT must be an integer between 1 and 65535.");
  process.exitCode = 1;
} else {
  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: "Internal server error" });
      } else {
        response.destroy();
      }
      console.error("Request failed:", error.message);
    });
  });

  server.on("error", (error) => {
    console.error("Server failed to start:", error.message);
    process.exitCode = 1;
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server listening on 0.0.0.0:${PORT}`);
  });
}
