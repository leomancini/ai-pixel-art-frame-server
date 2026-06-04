import 'dotenv/config';
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = 3136;
const anthropic = new Anthropic();


// SQLite setup
const db = new Database(join(__dirname, "data.sqlite"));
db.pragma("journal_mode = WAL");

app.use(express.json());

// Serve static files from dist
app.use(express.static(join(__dirname, "dist")));

// API endpoint for SQLite queries
app.post("/api/query", (req, res) => {
  try {
    const { sql, params = [] } = req.body;
    const stmt = db.prepare(sql);
    if (stmt.reader) {
      const rows = stmt.all(...params);
      res.json({ rows });
    } else {
      const result = stmt.run(...params);
      res.json({ result });
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Pixel frame stream for the ESP32 display
const FRAME_WIDTH = 32;
const FRAME_HEIGHT = 32;
const FRAME_MAGIC = Buffer.from("FRM0", "ascii");
const FRAME_PIXEL_BYTES = FRAME_WIDTH * FRAME_HEIGHT * 2; // RGB565
const FRAME_INTERVAL_MS = 40; // 25 fps

// Pack 8-bit RGB into a little-endian RGB565 uint16
function rgb565(r, g, b) {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

// The frame currently being streamed; null falls back to the test pattern
let currentFrame = null;

// Set the streamed image from a flat [r, g, b, ...] array, row-major 32x32
function setFrameFromRGB(rgb) {
  const frame = Buffer.alloc(FRAME_PIXEL_BYTES);
  for (let i = 0; i < FRAME_WIDTH * FRAME_HEIGHT; i++) {
    frame.writeUInt16LE(rgb565(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]), i * 2);
  }
  currentFrame = frame;
}

// Animated rainbow plasma so the board shows motion before any art is set
function testPatternFrame(t) {
  const frame = Buffer.alloc(FRAME_PIXEL_BYTES);
  for (let y = 0; y < FRAME_HEIGHT; y++) {
    for (let x = 0; x < FRAME_WIDTH; x++) {
      const v = Math.sin(x / 5 + t) + Math.sin(y / 4 - t / 2) + Math.sin((x + y) / 6 + t / 3);
      const r = Math.floor((Math.sin(v * Math.PI) + 1) * 127.5);
      const g = Math.floor((Math.sin(v * Math.PI + 2) + 1) * 127.5);
      const b = Math.floor((Math.sin(v * Math.PI + 4) + 1) * 127.5);
      frame.writeUInt16LE(rgb565(r, g, b), (y * FRAME_WIDTH + x) * 2);
    }
  }
  return frame;
}

app.get("/stream", (req, res) => {
  const socket = res.socket;
  socket.setNoDelay(true);

  // Write the response head directly to the socket, bypassing Node's HTTP
  // framing — the firmware reads raw body bytes and cannot parse chunked
  // encoding, so the body must be a bare byte stream terminated by close.
  socket.write(
    "HTTP/1.1 200 OK\r\n" +
      "Content-Type: application/octet-stream\r\n" +
      "Cache-Control: no-store\r\n" +
      "Connection: close\r\n" +
      "\r\n"
  );

  const startedAt = Date.now();
  const interval = setInterval(() => {
    if (socket.destroyed) {
      clearInterval(interval);
      return;
    }
    // Skip a frame rather than queueing unboundedly if the client is slow
    if (socket.writableLength > FRAME_PIXEL_BYTES * 4) return;
    const frame = currentFrame ?? testPatternFrame((Date.now() - startedAt) / 1000);
    socket.write(Buffer.concat([FRAME_MAGIC, frame]));
  }, FRAME_INTERVAL_MS);

  socket.on("close", () => clearInterval(interval));
  socket.on("error", () => clearInterval(interval));
});

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "dist", "index.html"));
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});

