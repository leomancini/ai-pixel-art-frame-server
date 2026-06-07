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

app.use(express.json({ limit: "16mb" })); // animation frames are large

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

// ── Animation store for the ESP32/MatrixPortal display ────────────────────
//
// The board downloads the whole animation once (GET /animation), plays it
// from RAM, and keeps a long-poll outstanding (GET /poll?id=N) on the same
// keep-alive connection so it learns about new art within milliseconds.
// All responses carry Content-Length so proxies never chunk them — the
// firmware does not parse chunked encoding.

const FRAME_WIDTH = 32;
const FRAME_HEIGHT = 32;
const FRAME_PIXEL_BYTES = FRAME_WIDTH * FRAME_HEIGHT * 2; // RGB565
const ANIM_MAGIC = Buffer.from("ANM0", "ascii");
const MAX_FRAMES = 64; // must match the firmware's RAM budget
const POLL_HOLD_MS = 20000; // keep under Apache's proxy timeout

// Pack 8-bit RGB into a little-endian RGB565 uint16
function rgb565(r, g, b) {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

// Current animation: monotonically increasing id, frames as RGB565 buffers
let animation = { id: 1, frames: [], delayMs: 60 };
let pollWaiters = [];

// Replace the animation from RGB frames (each a flat [r,g,b,...] array,
// row-major 32x32) and wake every long-poller.
function setAnimationFromRGB(rgbFrames, delayMs = 60) {
  const frames = rgbFrames.slice(0, MAX_FRAMES).map((rgb) => {
    const frame = Buffer.alloc(FRAME_PIXEL_BYTES);
    for (let i = 0; i < FRAME_WIDTH * FRAME_HEIGHT; i++) {
      frame.writeUInt16LE(rgb565(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]), i * 2);
    }
    return frame;
  });
  animation = { id: animation.id + 1, frames, delayMs };
  for (const waiter of pollWaiters) waiter();
  pollWaiters = [];
}

// Seamlessly looping rainbow plasma as the default before any art is set
function defaultPlasma(frameCount = 48) {
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    const ph = (i / frameCount) * 2 * Math.PI; // one full cycle = clean loop
    const rgb = [];
    for (let y = 0; y < FRAME_HEIGHT; y++) {
      for (let x = 0; x < FRAME_WIDTH; x++) {
        const v =
          Math.sin(x / 5 + ph) +
          Math.sin(y / 4 - 2 * ph) +
          Math.sin((x + y) / 6 + ph);
        rgb.push(
          Math.floor((Math.sin(v * Math.PI) + 1) * 127.5),
          Math.floor((Math.sin(v * Math.PI + 2) + 1) * 127.5),
          Math.floor((Math.sin(v * Math.PI + 4) + 1) * 127.5)
        );
      }
    }
    frames.push(rgb);
  }
  return frames;
}
setAnimationFromRGB(defaultPlasma(), 60);

// Full animation bundle: ANM0, uint32 id, uint16 frameCount, uint16 delayMs,
// then frameCount * 2048 bytes of RGB565 pixels (all little-endian).
app.get("/animation", (req, res) => {
  const header = Buffer.alloc(12);
  ANIM_MAGIC.copy(header, 0);
  header.writeUInt32LE(animation.id, 4);
  header.writeUInt16LE(animation.frames.length, 8);
  header.writeUInt16LE(animation.delayMs, 10);
  res.set("Content-Type", "application/octet-stream");
  res.set("Cache-Control", "no-store");
  res.send(Buffer.concat([header, ...animation.frames]));
});

// Long poll: responds "ID <n>\n" as soon as the animation id differs from
// the client's, or after POLL_HOLD_MS with the (unchanged) current id.
app.get("/poll", (req, res) => {
  const clientId = parseInt(req.query.id, 10) || 0;
  const respond = () => {
    res.set("Content-Type", "text/plain");
    res.set("Cache-Control", "no-store");
    res.send(`ID ${animation.id}\n`);
  };
  if (animation.id !== clientId) return respond();
  const timer = setTimeout(() => {
    pollWaiters = pollWaiters.filter((w) => w !== wake);
    respond();
  }, POLL_HOLD_MS);
  const wake = () => {
    clearTimeout(timer);
    respond();
  };
  pollWaiters.push(wake);
  res.on("close", () => {
    clearTimeout(timer);
    pollWaiters = pollWaiters.filter((w) => w !== wake);
  });
});

// Push new art: { frames: [[r,g,b,...], ...], delayMs } — each frame a flat
// 3072-element array. The board picks it up via its outstanding long poll.
app.post("/api/animation", (req, res) => {
  const { frames, delayMs = 60 } = req.body ?? {};
  if (!Array.isArray(frames) || frames.length === 0) {
    return res.status(400).json({ error: "frames must be a non-empty array" });
  }
  if (frames.length > MAX_FRAMES) {
    return res.status(400).json({ error: `at most ${MAX_FRAMES} frames` });
  }
  for (const f of frames) {
    if (!Array.isArray(f) || f.length !== FRAME_WIDTH * FRAME_HEIGHT * 3) {
      return res.status(400).json({
        error: `each frame must be a flat RGB array of ${FRAME_WIDTH * FRAME_HEIGHT * 3} values`,
      });
    }
  }
  setAnimationFromRGB(frames, Math.max(20, Math.min(5000, delayMs)));
  res.json({ id: animation.id, frames: animation.frames.length });
});

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "dist", "index.html"));
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});

