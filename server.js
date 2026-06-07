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

// ── Preset animations ──────────────────────────────────────────────────────
// All presets are generated as seamless loops: every time-dependent term
// completes an integer number of cycles over the frame count.

function plasmaFrames(frameCount = 48) {
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

function starfieldFrames(frameCount = 48) {
  // Deterministic stars; drift per loop is a multiple of the width so the
  // loop is seamless. Three parallax layers.
  const layers = [
    { count: 14, speed: 2 / 3, bright: 90, tint: [0.7, 0.8, 1] },
    { count: 10, speed: 4 / 3, bright: 170, tint: [0.85, 0.9, 1] },
    { count: 6, speed: 2, bright: 255, tint: [1, 1, 1] },
  ];
  // simple deterministic pseudo-random
  let seed = 1234;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const stars = [];
  for (const layer of layers) {
    for (let s = 0; s < layer.count; s++) {
      stars.push({ x0: rand() * 32, y: Math.floor(rand() * 32), ...layer });
    }
  }
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    const rgb = new Array(FRAME_WIDTH * FRAME_HEIGHT * 3).fill(0);
    for (const st of stars) {
      const x = Math.floor((st.x0 + 32 - ((st.speed * i) % 32)) % 32);
      const o = (st.y * FRAME_WIDTH + x) * 3;
      rgb[o] = Math.min(255, rgb[o] + st.bright * st.tint[0]);
      rgb[o + 1] = Math.min(255, rgb[o + 1] + st.bright * st.tint[1]);
      rgb[o + 2] = Math.min(255, rgb[o + 2] + st.bright * st.tint[2]);
    }
    frames.push(rgb.map(Math.floor));
  }
  return frames;
}

function orbitFrames(frameCount = 64) {
  // A glowing ball on a Lissajous path with a fading trail; hue rotates
  // once per loop.
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    const rgb = new Array(FRAME_WIDTH * FRAME_HEIGHT * 3).fill(0);
    for (let trail = 7; trail >= 0; trail--) {
      const p = ((i - trail + frameCount) % frameCount) / frameCount;
      const cx = 16 + 11 * Math.sin(2 * Math.PI * p);
      const cy = 16 + 11 * Math.sin(4 * Math.PI * p + Math.PI / 3);
      const hue = 2 * Math.PI * p;
      const fade = 1 - trail / 9;
      const cr = (Math.sin(hue) + 1) * 127.5 * fade;
      const cg = (Math.sin(hue + 2.1) + 1) * 127.5 * fade;
      const cb = (Math.sin(hue + 4.2) + 1) * 127.5 * fade;
      for (let y = 0; y < FRAME_HEIGHT; y++) {
        for (let x = 0; x < FRAME_WIDTH; x++) {
          const d2 = (x - cx) ** 2 + (y - cy) ** 2;
          const glow = Math.exp(-d2 / 3.5);
          if (glow < 0.02) continue;
          const o = (y * FRAME_WIDTH + x) * 3;
          rgb[o] = Math.min(255, rgb[o] + cr * glow);
          rgb[o + 1] = Math.min(255, rgb[o + 1] + cg * glow);
          rgb[o + 2] = Math.min(255, rgb[o + 2] + cb * glow);
        }
      }
    }
    frames.push(rgb.map(Math.floor));
  }
  return frames;
}

const presets = {
  plasma: { name: "Plasma", delayMs: 60, generate: plasmaFrames },
  starfield: { name: "Starfield", delayMs: 80, generate: starfieldFrames },
  orbit: { name: "Orbit", delayMs: 40, generate: orbitFrames },
};
for (const preset of Object.values(presets)) {
  preset.frames = preset.generate(); // pre-render at startup
}

let activePresetKey = "plasma";
setAnimationFromRGB(presets.plasma.frames, presets.plasma.delayMs);

// List presets for the picker UI
app.get("/api/presets", (req, res) => {
  res.json(
    Object.entries(presets).map(([key, p]) => ({
      key,
      name: p.name,
      frameCount: p.frames.length,
      delayMs: p.delayMs,
      active: key === activePresetKey,
    }))
  );
});

// Full frame data for one preset, for canvas previews in the UI
app.get("/api/presets/:key", (req, res) => {
  const preset = presets[req.params.key];
  if (!preset) return res.status(404).json({ error: "unknown preset" });
  res.set("Cache-Control", "max-age=3600"); // presets are static
  res.json({ frames: preset.frames, delayMs: preset.delayMs });
});

// Make a preset the live animation — the frame picks it up via long poll
app.post("/api/presets/:key/activate", (req, res) => {
  const preset = presets[req.params.key];
  if (!preset) return res.status(404).json({ error: "unknown preset" });
  activePresetKey = req.params.key;
  setAnimationFromRGB(preset.frames, preset.delayMs);
  res.json({ id: animation.id, key: activePresetKey });
});

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
  activePresetKey = null; // custom art, no preset active
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

