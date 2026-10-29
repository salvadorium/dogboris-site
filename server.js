"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const PORT = Number(process.env.PORT || 3000);
const INDEX_PATH = path.join(__dirname, "index.html");
const DATABASE_PATH = process.env.DATABASE_PATH || path.join(__dirname, "data", "dogboris.sqlite");
const MENU = Object.freeze([
  { id: "10:00", time: "10:00" },
  { id: "12:00", time: "12:00" },
  { id: "14:00", time: "14:00" },
  { id: "16:00", time: "16:00" },
  { id: "18:00", time: "18:00" }
].map(Object.freeze));
const MOSCOW_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Europe/Moscow"
});

fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
const database = new DatabaseSync(DATABASE_PATH);
database.exec(`
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS slots (
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    full_name TEXT NOT NULL,
    UNIQUE (date, time)
  ) STRICT;
`);

const getBookings = database.prepare(
  "SELECT time, full_name AS fullName FROM slots WHERE date = ?"
);
const insertBooking = database.prepare(`
  INSERT INTO slots (date, time, full_name)
  VALUES (?, ?, ?)
  ON CONFLICT (date, time) DO NOTHING
`);

function getMoscowDate() {
  const parts = Object.fromEntries(
    MOSCOW_DATE_FORMATTER.formatToParts(new Date())
      .filter((part) => part.type !== "literal")
      .map(({ type, value }) => [type, value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

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
    const date = getMoscowDate();
    const bookings = new Map(
      getBookings.all(date).map(({ time, fullName }) => [time, fullName])
    );
    sendJson(response, 200, {
      date,
      items: MENU.map((slot) => ({
        ...slot,
        booked: bookings.has(slot.id),
        fullName: bookings.get(slot.id) || null
      }))
    });
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

    const slot = payload && MENU.find((item) => item.id === payload.id);
    const fullName = typeof payload?.fullName === "string" ? payload.fullName.trim() : "";
    if (!slot) {
      sendJson(response, 400, { error: "Выберите время из расписания." });
      return;
    }
    if (!fullName || fullName.length > 120 || /[\u0000-\u001f\u007f]/u.test(fullName)) {
      sendJson(response, 400, { error: "Укажите ФИО (не более 120 символов)." });
      return;
    }

    const date = getMoscowDate();
    const result = insertBooking.run(date, slot.time, fullName);
    if (result.changes === 0) {
      sendJson(response, 409, {
        error: `Слот ${slot.time} уже занят. Выберите другое время.`
      });
      return;
    }

    sendJson(response, 201, {
      ok: true,
      message: `Вы записаны на ${slot.time}.`,
      booking: { date, time: slot.time, fullName }
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
