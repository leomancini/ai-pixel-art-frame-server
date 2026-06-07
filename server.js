import 'dotenv/config';
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import Database from "better-sqlite3";
import vm from "node:vm";
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
let activeGalleryId = null;
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
  activeGalleryId = null;
  setAnimationFromRGB(preset.frames, preset.delayMs);
  res.json({ id: animation.id, key: activePresetKey });
});

// ── AI-generated animations (gallery) ──────────────────────────────────────
//
// Claude writes a small deterministic render function rather than raw pixels
// (64 frames of literal RGB would be ~200K numbers). The server executes it
// in a node:vm sandbox to rasterize the frames, validates them, and stores
// the result in SQLite. Generated animations live in the gallery alongside
// the presets and activate the same way.

db.exec(`
  CREATE TABLE IF NOT EXISTS animations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt TEXT NOT NULL,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    frame_count INTEGER NOT NULL,
    delay_ms INTEGER NOT NULL,
    frames BLOB NOT NULL, -- frame_count * 3072 bytes of raw RGB
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const GENERATOR_SYSTEM_PROMPT = `You write animations for a 32x32 RGB LED matrix (a physical pixel-art frame on a wall).

You respond with JSON containing a JavaScript render function. The function signature must be exactly:

  function render(frame, frameCount, x, y)

It is called for every pixel of every frame: frame is 0..frameCount-1, x/y are 0..31 (origin top-left), and it must return an array [r, g, b] with values 0..255. It must be pure and deterministic — same inputs, same output. Only Math is available; no other globals, no Date, no Math.random (use a hash function if you need deterministic noise), no state between calls except module-level constants/precomputation you define alongside the function.

Requirements:
- SEAMLESS LOOP: the animation must loop perfectly. Every time-dependent term must complete an integer number of cycles over frameCount frames (use phase = frame / frameCount * 2 * Math.PI and integer multiples of it; for moving objects, displacement over the loop must be a multiple of 32 or return to start).
- This is a physical LED matrix: saturated colors and black backgrounds look great; muddy mid-grays look bad. The panel has 16 brightness levels per channel, so prefer bold contrast over subtle gradients.
- 32x32 is tiny: keep compositions simple and readable. One clear subject beats intricate detail.
- Pick frameCount (8-64) and delayMs (30-150) to suit the motion. Use the full 64 frames only when the motion needs it.
- The name should be short (1-3 words), evocative, suitable as a gallery label.

You may define helper functions and precomputed module-level constants before render. Keep the total code under 150 lines.`;

const ANIMATION_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Short gallery label, 1-3 words" },
    frameCount: { type: "integer", description: "Number of frames, 8-64" },
    delayMs: { type: "integer", description: "Per-frame delay in ms, 30-150" },
    code: {
      type: "string",
      description:
        "JavaScript defining function render(frame, frameCount, x, y) -> [r,g,b], plus any helpers/constants",
    },
  },
  required: ["name", "frameCount", "delayMs", "code"],
  additionalProperties: false,
};

// Execute generated code in a vm sandbox and rasterize all frames.
// Throws (with a useful message) if the code is broken.
function rasterize(code, frameCount) {
  const harness = `
    "use strict";
    ${code}
    ;(() => {
      const frames = [];
      for (let f = 0; f < ${frameCount}; f++) {
        const frame = new Array(${FRAME_WIDTH * FRAME_HEIGHT * 3});
        for (let y = 0; y < ${FRAME_HEIGHT}; y++) {
          for (let x = 0; x < ${FRAME_WIDTH}; x++) {
            const px = render(f, ${frameCount}, x, y);
            const o = (y * ${FRAME_WIDTH} + x) * 3;
            for (let c = 0; c < 3; c++) {
              const v = Math.round(Number(px && px[c]));
              frame[o + c] = v >= 0 ? (v <= 255 ? v : 255) : 0; // clamps NaN to 0
            }
          }
        }
        frames.push(frame);
      }
      return frames;
    })()
  `;
  const context = vm.createContext({ Math });
  return new vm.Script(harness).runInContext(context, { timeout: 5000 });
}

// Ask Claude for an animation and rasterize it; one retry with the error
// fed back if the generated code fails to run.
async function generateAnimation(prompt) {
  const messages = [{ role: "user", content: prompt }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const stream = anthropic.messages.stream({
      model: "claude-opus-4-8",
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      system: [
        {
          type: "text",
          text: GENERATOR_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: ANIMATION_SCHEMA },
      },
      messages,
    });
    const message = await stream.finalMessage();
    const text = message.content.find((b) => b.type === "text")?.text;
    const result = JSON.parse(text);
    result.frameCount = Math.max(8, Math.min(MAX_FRAMES, result.frameCount));
    result.delayMs = Math.max(20, Math.min(5000, result.delayMs));
    try {
      result.frames = rasterize(result.code, result.frameCount);
      return result;
    } catch (error) {
      if (attempt === 1) throw error;
      console.log(`[!] generated code failed (${error.message}), retrying`);
      messages.push(
        { role: "assistant", content: message.content },
        {
          role: "user",
          content: `Your render code threw an error when executed: ${error.message}\nPlease fix it and respond with the corrected JSON.`,
        }
      );
    }
  }
}

function galleryRowToFrames(row) {
  const frames = [];
  for (let f = 0; f < row.frame_count; f++) {
    frames.push(Array.from(row.frames.subarray(f * 3072, (f + 1) * 3072)));
  }
  return frames;
}

function activateGalleryRow(row) {
  activePresetKey = null;
  activeGalleryId = row.id;
  setAnimationFromRGB(galleryRowToFrames(row), row.delay_ms);
}

// Generate a new animation from a prompt, save it, and show it on the frame
app.post("/api/generate", async (req, res) => {
  const prompt = (req.body?.prompt ?? "").trim();
  if (!prompt) return res.status(400).json({ error: "prompt is required" });
  if (prompt.length > 500) {
    return res.status(400).json({ error: "prompt too long (max 500 chars)" });
  }
  try {
    const anim = await generateAnimation(prompt);
    const blob = Buffer.from(anim.frames.flat());
    const row = db
      .prepare(
        `INSERT INTO animations (prompt, name, code, frame_count, delay_ms, frames)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
      )
      .get(prompt, anim.name, anim.code, anim.frames.length, anim.delayMs, blob);
    activateGalleryRow(row);
    res.json({
      id: row.id,
      name: row.name,
      frameCount: row.frame_count,
      delayMs: row.delay_ms,
    });
  } catch (error) {
    console.error("[!] generation failed:", error);
    res.status(500).json({ error: `generation failed: ${error.message}` });
  }
});

// List the gallery (newest first; no frame data — fetch per-item for previews)
app.get("/api/gallery", (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, prompt, name, frame_count, delay_ms, created_at
       FROM animations ORDER BY id DESC`
    )
    .all();
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      prompt: r.prompt,
      frameCount: r.frame_count,
      delayMs: r.delay_ms,
      createdAt: r.created_at,
      active: r.id === activeGalleryId,
    }))
  );
});

// Frame data for one gallery item, for canvas previews
app.get("/api/gallery/:id", (req, res) => {
  const row = db
    .prepare(`SELECT * FROM animations WHERE id = ?`)
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  res.set("Cache-Control", "max-age=3600"); // gallery items are immutable
  res.json({ frames: galleryRowToFrames(row), delayMs: row.delay_ms });
});

// Show a gallery animation on the frame
app.post("/api/gallery/:id/activate", (req, res) => {
  const row = db
    .prepare(`SELECT * FROM animations WHERE id = ?`)
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  activateGalleryRow(row);
  res.json({ id: animation.id, galleryId: row.id });
});

// Remove a gallery animation
app.delete("/api/gallery/:id", (req, res) => {
  const result = db
    .prepare(`DELETE FROM animations WHERE id = ?`)
    .run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: "not found" });
  if (activeGalleryId === Number(req.params.id)) activeGalleryId = null;
  res.json({ deleted: true });
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
  activeGalleryId = null;
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

