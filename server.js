import 'dotenv/config';
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import Database from "better-sqlite3";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import crypto from "node:crypto";
import vm from "node:vm";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Configuration ───────────────────────────────────────────────────────────
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
if (!ADMIN_EMAIL) {
  console.error("[fatal] ADMIN_EMAIL must be set (the sole admin's Google email)");
  process.exit(1);
}
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? null;
if (!GOOGLE_CLIENT_ID) {
  console.warn("[!] GOOGLE_CLIENT_ID not set — sign-in will be unavailable until it is");
}
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  SESSION_SECRET = crypto.randomBytes(32).toString("hex");
  console.warn("[!] SESSION_SECRET not set — using an ephemeral secret (sessions reset on restart)");
}

const app = express();
const port = 3136;
const anthropic = new Anthropic();
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

app.set("trust proxy", true); // honor X-Forwarded-Proto from the Apache reverse proxy
app.use(express.json({ limit: "16mb" })); // animation frames are large
app.use(cookieParser());
app.use(express.static(join(__dirname, "dist")));

// ── SQLite setup + schema ─────────────────────────────────────────────────────
const db = new Database(join(__dirname, "data.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON"); // needed for ON DELETE CASCADE

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
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,        -- stored lowercased
    google_sub TEXT UNIQUE,            -- NULL until first login (pre-provisioned by email)
    name TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS frames (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,         -- stable id baked into firmware
    name TEXT NOT NULL,
    device_key_hash TEXT NOT NULL,     -- sha256 of the device key; plaintext shown once
    anim_seq INTEGER NOT NULL DEFAULT 1, -- persisted monotonic animation id (restart-safe)
    active_kind TEXT NOT NULL DEFAULT 'preset', -- 'preset' | 'gallery'
    active_preset_key TEXT,
    active_gallery_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS frame_access (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    frame_id INTEGER NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, frame_id)
  );
`);

// Add animations.frame_id if this DB predates multi-frame support.
const hasFrameId = db
  .prepare("PRAGMA table_info(animations)")
  .all()
  .some((c) => c.name === "frame_id");
if (!hasFrameId) {
  db.exec("ALTER TABLE animations ADD COLUMN frame_id INTEGER REFERENCES frames(id)");
}

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

// Seed the admin user so they can sign in even before being pre-provisioned.
db.prepare(
  "INSERT OR IGNORE INTO users (email, is_admin) VALUES (?, 1)"
).run(ADMIN_EMAIL);

// ── Animation store for the ESP32/MatrixPortal displays ───────────────────────
//
// Each frame downloads its whole animation once (GET /animation?frame=SLUG),
// plays it from RAM, and keeps a long-poll outstanding (GET /poll?frame=SLUG&
// id=N) on the same keep-alive connection so it learns about new art within
// milliseconds. Both requests carry the frame's device key in an X-Frame-Key
// header. All responses carry Content-Length so proxies never chunk them — the
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

// Convert flat [r,g,b,...] frames (row-major 32x32) into RGB565 buffers.
function rgbToBuffers(rgbFrames) {
  return rgbFrames.slice(0, MAX_FRAMES).map((rgb) => {
    const frame = Buffer.alloc(FRAME_PIXEL_BYTES);
    for (let i = 0; i < FRAME_WIDTH * FRAME_HEIGHT; i++) {
      frame.writeUInt16LE(rgb565(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]), i * 2);
    }
    return frame;
  });
}

// In-RAM playback state per frame, keyed by slug. The persisted source of
// truth lives on the `frames` row (anim_seq + active selection); this Map
// holds the rasterized RGB565 buffers and the long-poll waiters.
const runtimes = new Map(); // slug -> { animId, frames, delayMs, pollWaiters, activePresetKey, activeGalleryId }

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
const DEFAULT_PRESET_KEY = "plasma";

// ── Per-frame state helpers ───────────────────────────────────────────────────

function galleryRowToFrames(row) {
  const frames = [];
  for (let f = 0; f < row.frame_count; f++) {
    frames.push(Array.from(row.frames.subarray(f * 3072, (f + 1) * 3072)));
  }
  return frames;
}

// Build (or rebuild) a frame's RAM runtime from its persisted active selection.
// Does NOT bump anim_seq — the device keeps its remembered id across restarts.
function loadFrameRuntime(frameRow) {
  const rt = {
    animId: frameRow.anim_seq,
    frames: [],
    delayMs: 60,
    pollWaiters: [],
    activePresetKey: null,
    activeGalleryId: null,
  };
  if (frameRow.active_kind === "gallery" && frameRow.active_gallery_id != null) {
    const row = db
      .prepare("SELECT * FROM animations WHERE id = ? AND frame_id = ?")
      .get(frameRow.active_gallery_id, frameRow.id);
    if (row) {
      rt.frames = rgbToBuffers(galleryRowToFrames(row));
      rt.delayMs = row.delay_ms;
      rt.activeGalleryId = row.id;
    }
  }
  if (rt.frames.length === 0) {
    // preset selection (or fallback if the gallery item vanished)
    const key =
      frameRow.active_preset_key && presets[frameRow.active_preset_key]
        ? frameRow.active_preset_key
        : DEFAULT_PRESET_KEY;
    rt.frames = rgbToBuffers(presets[key].frames);
    rt.delayMs = presets[key].delayMs;
    rt.activePresetKey = key;
  }
  runtimes.set(frameRow.slug, rt);
  return rt;
}

// Persist the new selection + bumped id, then wake this frame's long-pollers.
// anim_seq is written BEFORE waking waiters so a crash can't lose the bump.
function bumpFrame(slug, kind, presetKey, galleryId) {
  const rt = runtimes.get(slug);
  rt.animId += 1;
  db.prepare(
    `UPDATE frames SET anim_seq = ?, active_kind = ?, active_preset_key = ?, active_gallery_id = ?
     WHERE slug = ?`
  ).run(rt.animId, kind, presetKey, galleryId, slug);
  for (const wake of rt.pollWaiters) wake();
  rt.pollWaiters = [];
}

function setFramePreset(slug, presetKey) {
  const rt = runtimes.get(slug);
  rt.frames = rgbToBuffers(presets[presetKey].frames);
  rt.delayMs = presets[presetKey].delayMs;
  rt.activePresetKey = presetKey;
  rt.activeGalleryId = null;
  bumpFrame(slug, "preset", presetKey, null);
}

function setFrameGallery(slug, row) {
  const rt = runtimes.get(slug);
  rt.frames = rgbToBuffers(galleryRowToFrames(row));
  rt.delayMs = row.delay_ms;
  rt.activePresetKey = null;
  rt.activeGalleryId = row.id;
  bumpFrame(slug, "gallery", null, row.id);
}

// ── First-run migration: seed a default frame and attach the legacy gallery ───
if (db.prepare("SELECT COUNT(*) AS n FROM frames").get().n === 0) {
  const key = crypto.randomBytes(24).toString("hex");
  const info = db
    .prepare(
      `INSERT INTO frames (slug, name, device_key_hash, active_kind, active_preset_key)
       VALUES ('default', 'Default Frame', ?, 'preset', ?)`
    )
    .run(sha256(key), DEFAULT_PRESET_KEY);
  db.prepare("UPDATE animations SET frame_id = ? WHERE frame_id IS NULL").run(
    info.lastInsertRowid
  );
  // NB: do not log the plaintext key — logs persist on disk (e.g. pm2). The
  // migrated key is intentionally unrecoverable; mint a fresh one from the
  // Admin panel ("rotate key") before flashing a board for this frame.
  console.log(
    `[migration] seeded 'default' frame (id ${info.lastInsertRowid}); legacy gallery attached.\n` +
      `[migration] rotate its device key in the Admin panel to get a key for flashing.`
  );
}

// Load every frame's runtime into RAM at boot.
for (const frameRow of db.prepare("SELECT * FROM frames").all()) {
  loadFrameRuntime(frameRow);
}

// ── AI-generated animations (gallery) ──────────────────────────────────────
//
// Claude writes a small deterministic render function rather than raw pixels
// (64 frames of literal RGB would be ~200K numbers). The server executes it
// in a node:vm sandbox to rasterize the frames, validates them, and stores
// the result in SQLite scoped to a frame. Generated animations live in that
// frame's gallery alongside the shared presets and activate the same way.

const GENERATOR_SYSTEM_PROMPT = `You write animations for a 32x32 RGB LED matrix (a physical pixel-art frame on a wall).

You respond with JSON containing a JavaScript render function. The function signature must be exactly:

  function render(frame, frameCount, x, y)

It is called for every pixel of every frame: frame is 0..frameCount-1, x/y are 0..31 (origin top-left), and it must return an array [r, g, b] with values 0..255. It must be pure and deterministic — same inputs, same output. Only Math is available; no other globals, no Date, no Math.random (use a hash function if you need deterministic noise), no state between calls except module-level constants/precomputation you define alongside the function.

Requirements:
- SEAMLESS LOOP: the animation must loop perfectly. Every time-dependent term must complete an integer number of cycles over frameCount frames (use phase = frame / frameCount * 2 * Math.PI and integer multiples of it; for moving objects, displacement over the loop must be a multiple of 32 or return to start).
- This is a physical LED matrix: saturated colors and pure-black backgrounds look great; muddy mid-grays look bad. The panel has only 16 brightness levels per channel and CANNOT render dim colors — channel values between 1 and ~50 don't read as a smooth dark shade, they show up as sparse, distractingly lit dots. Never use dim fills, dark ambient glows, or long dark gradient tails. Backgrounds and "dark" areas must be exactly [0, 0, 0]; anything meant to be visible should use channel values of roughly 60+. When fading something out, snap to true black once it drops below that floor instead of trailing through near-black values.
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

// ── Auth: Google ID token -> our own httpOnly JWT session cookie ──────────────

const SESSION_COOKIE = "session";

function signSession(user) {
  return jwt.sign(
    { uid: user.id, email: user.email, name: user.name, isAdmin: !!user.is_admin },
    SESSION_SECRET,
    { expiresIn: "30d" }
  );
}

function currentUser(req) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  try {
    return jwt.verify(token, SESSION_SECRET);
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: "auth required" });
  req.user = u;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user.isAdmin) return res.status(403).json({ error: "admin only" });
    next();
  });
}

// Resolves :id to a frame and checks the signed-in user may control it.
function requireFrameAccess(req, res, next) {
  requireAuth(req, res, () => {
    const frame = db.prepare("SELECT * FROM frames WHERE id = ?").get(req.params.id);
    if (!frame) return res.status(404).json({ error: "frame not found" });
    if (!req.user.isAdmin) {
      const has = db
        .prepare("SELECT 1 FROM frame_access WHERE user_id = ? AND frame_id = ?")
        .get(req.user.uid, frame.id);
      if (!has) return res.status(403).json({ error: "no access to this frame" });
    }
    req.frame = frame;
    next();
  });
}

// Public config the SPA needs before sign-in
app.get("/api/config", (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

// Exchange a Google ID token for a session. Sign-in is gated: only the admin
// email or a pre-provisioned user (a row added by the admin) is allowed.
app.post("/api/auth/google", async (req, res) => {
  if (!googleClient) {
    return res.status(503).json({ error: "sign-in is not configured" });
  }
  const credential = req.body?.credential;
  if (!credential) return res.status(400).json({ error: "credential is required" });
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: "invalid Google token" });
  }
  if (!payload?.email || !payload.email_verified) {
    return res.status(401).json({ error: "email not verified by Google" });
  }
  const email = payload.email.trim().toLowerCase();
  const isAdmin = email === ADMIN_EMAIL;

  let user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user && !isAdmin) {
    return res
      .status(403)
      .json({ error: "this account isn't authorized — ask the admin for access" });
  }
  if (!user) {
    db.prepare(
      "INSERT INTO users (email, google_sub, name, is_admin) VALUES (?, ?, ?, 1)"
    ).run(email, payload.sub, payload.name ?? null);
  } else {
    db.prepare(
      "UPDATE users SET google_sub = ?, name = COALESCE(?, name), is_admin = ? WHERE id = ?"
    ).run(payload.sub, payload.name ?? null, isAdmin ? 1 : 0, user.id);
  }
  user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

  res.cookie(SESSION_COOKIE, signSession(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure, // true behind the TLS proxy, false on http://localhost
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });
  res.json({ id: user.id, email: user.email, name: user.name, isAdmin: !!user.is_admin });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: "not signed in" });
  res.json({ id: u.uid, email: u.email, name: u.name, isAdmin: !!u.isAdmin });
});

// ── Shared preset endpoints (frame-independent data; activation is per frame) ──

app.get("/api/presets", requireAuth, (req, res) => {
  res.json(
    Object.entries(presets).map(([key, p]) => ({
      key,
      name: p.name,
      frameCount: p.frames.length,
      delayMs: p.delayMs,
    }))
  );
});

app.get("/api/presets/:key", requireAuth, (req, res) => {
  const preset = presets[req.params.key];
  if (!preset) return res.status(404).json({ error: "unknown preset" });
  res.set("Cache-Control", "max-age=3600"); // presets are static
  res.json({ frames: preset.frames, delayMs: preset.delayMs });
});

// ── Frame-scoped control endpoints ────────────────────────────────────────────

// Frames the signed-in user may control (admins see all).
app.get("/api/frames", requireAuth, (req, res) => {
  const frames = req.user.isAdmin
    ? db.prepare("SELECT * FROM frames ORDER BY name").all()
    : db
        .prepare(
          `SELECT f.* FROM frames f
           JOIN frame_access a ON a.frame_id = f.id
           WHERE a.user_id = ? ORDER BY f.name`
        )
        .all(req.user.uid);
  res.json(
    frames.map((f) => ({
      id: f.id,
      slug: f.slug,
      name: f.name,
      active: {
        kind: f.active_kind,
        presetKey: f.active_preset_key,
        galleryId: f.active_gallery_id,
      },
    }))
  );
});

// A user can rename a frame they can access. This is just the display label —
// the firmware identifies the board by its immutable slug, so renaming is safe.
app.patch("/api/frames/:id/name", requireFrameAccess, (req, res) => {
  const name = (req.body?.name ?? "").trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: "name is required" });
  db.prepare("UPDATE frames SET name = ? WHERE id = ?").run(name, req.frame.id);
  res.json({ ok: true, name });
});

// One frame's gallery (newest first; no frame data — fetch per-item for previews)
app.get("/api/frames/:id/gallery", requireFrameAccess, (req, res) => {
  const rows = db
    .prepare(
      `SELECT id, prompt, name, frame_count, delay_ms, created_at
       FROM animations WHERE frame_id = ? ORDER BY id DESC`
    )
    .all(req.frame.id);
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      prompt: r.prompt,
      frameCount: r.frame_count,
      delayMs: r.delay_ms,
      createdAt: r.created_at,
      active: r.id === req.frame.active_gallery_id,
    }))
  );
});

// Frame data for one gallery item, for canvas previews
app.get("/api/frames/:id/gallery/:gid", requireFrameAccess, (req, res) => {
  const row = db
    .prepare("SELECT * FROM animations WHERE id = ? AND frame_id = ?")
    .get(req.params.gid, req.frame.id);
  if (!row) return res.status(404).json({ error: "not found" });
  res.set("Cache-Control", "max-age=3600"); // gallery items are immutable
  res.json({ frames: galleryRowToFrames(row), delayMs: row.delay_ms });
});

// Generate a new animation from a prompt, save it to this frame, show it.
app.post("/api/frames/:id/generate", requireFrameAccess, async (req, res) => {
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
        `INSERT INTO animations (prompt, name, code, frame_count, delay_ms, frames, frame_id)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
      )
      .get(prompt, anim.name, anim.code, anim.frames.length, anim.delayMs, blob, req.frame.id);
    setFrameGallery(req.frame.slug, row);
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

// Show a gallery animation on the frame
app.post("/api/frames/:id/gallery/:gid/activate", requireFrameAccess, (req, res) => {
  const row = db
    .prepare("SELECT * FROM animations WHERE id = ? AND frame_id = ?")
    .get(req.params.gid, req.frame.id);
  if (!row) return res.status(404).json({ error: "not found" });
  setFrameGallery(req.frame.slug, row);
  res.json({ ok: true });
});

// Remove a gallery animation (falls back to a preset if it was live)
app.delete("/api/frames/:id/gallery/:gid", requireFrameAccess, (req, res) => {
  const row = db
    .prepare("SELECT * FROM animations WHERE id = ? AND frame_id = ?")
    .get(req.params.gid, req.frame.id);
  if (!row) return res.status(404).json({ error: "not found" });
  db.prepare("DELETE FROM animations WHERE id = ?").run(row.id);
  if (req.frame.active_gallery_id === row.id) {
    setFramePreset(req.frame.slug, DEFAULT_PRESET_KEY);
  }
  res.json({ deleted: true });
});

// Make a preset the live animation on this frame
app.post("/api/frames/:id/presets/:key/activate", requireFrameAccess, (req, res) => {
  if (!presets[req.params.key]) return res.status(404).json({ error: "unknown preset" });
  setFramePreset(req.frame.slug, req.params.key);
  res.json({ ok: true });
});

// ── Admin: frames, users, access ──────────────────────────────────────────────

function slugify(name) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "frame"
  );
}

app.get("/api/admin/frames", requireAdmin, (req, res) => {
  const frames = db.prepare("SELECT * FROM frames ORDER BY name").all();
  res.json(
    frames.map((f) => ({ id: f.id, slug: f.slug, name: f.name, createdAt: f.created_at }))
  );
});

// Register a frame. Returns the plaintext device key ONCE (only the hash is
// stored) — flash it into that board's secrets.h.
app.post("/api/admin/frames", requireAdmin, (req, res) => {
  const name = (req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name is required" });
  let slug = slugify(name);
  const base = slug;
  for (let n = 2; db.prepare("SELECT 1 FROM frames WHERE slug = ?").get(slug); n++) {
    slug = `${base}-${n}`;
  }
  const key = crypto.randomBytes(24).toString("hex");
  const info = db
    .prepare(
      `INSERT INTO frames (slug, name, device_key_hash, active_kind, active_preset_key)
       VALUES (?, ?, ?, 'preset', ?)`
    )
    .run(slug, name, sha256(key), DEFAULT_PRESET_KEY);
  loadFrameRuntime(db.prepare("SELECT * FROM frames WHERE id = ?").get(info.lastInsertRowid));
  res.json({ id: info.lastInsertRowid, slug, name, deviceKey: key });
});

app.patch("/api/admin/frames/:id", requireAdmin, (req, res) => {
  const frame = db.prepare("SELECT * FROM frames WHERE id = ?").get(req.params.id);
  if (!frame) return res.status(404).json({ error: "not found" });
  const name = (req.body?.name ?? "").trim();
  if (!name) return res.status(400).json({ error: "name is required" });
  db.prepare("UPDATE frames SET name = ? WHERE id = ?").run(name, frame.id);
  res.json({ ok: true });
});

// Rotate a frame's device key (returns the new plaintext once).
app.post("/api/admin/frames/:id/key", requireAdmin, (req, res) => {
  const frame = db.prepare("SELECT * FROM frames WHERE id = ?").get(req.params.id);
  if (!frame) return res.status(404).json({ error: "not found" });
  const key = crypto.randomBytes(24).toString("hex");
  db.prepare("UPDATE frames SET device_key_hash = ? WHERE id = ?").run(sha256(key), frame.id);
  res.json({ deviceKey: key });
});

app.delete("/api/admin/frames/:id", requireAdmin, (req, res) => {
  const frame = db.prepare("SELECT * FROM frames WHERE id = ?").get(req.params.id);
  if (!frame) return res.status(404).json({ error: "not found" });
  db.prepare("DELETE FROM animations WHERE frame_id = ?").run(frame.id);
  db.prepare("DELETE FROM frames WHERE id = ?").run(frame.id); // frame_access cascades
  runtimes.delete(frame.slug);
  res.json({ deleted: true });
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
  const users = db
    .prepare("SELECT id, email, name, is_admin, google_sub, created_at FROM users ORDER BY email")
    .all();
  const access = db.prepare("SELECT user_id, frame_id FROM frame_access").all();
  const byUser = {};
  for (const a of access) (byUser[a.user_id] ??= []).push(a.frame_id);
  res.json(
    users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      isAdmin: !!u.is_admin,
      linked: !!u.google_sub, // has signed in at least once
      frameIds: byUser[u.id] ?? [],
    }))
  );
});

// Pre-provision a user by email so they're allowed to sign in.
app.post("/api/admin/users", requireAdmin, (req, res) => {
  const email = (req.body?.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "a valid email is required" });
  }
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) {
    return res.status(409).json({ error: "that user already exists" });
  }
  const info = db
    .prepare("INSERT INTO users (email, is_admin) VALUES (?, ?)")
    .run(email, email === ADMIN_EMAIL ? 1 : 0);
  res.json({ id: info.lastInsertRowid, email });
});

app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.params.id);
  if (!user) return res.status(404).json({ error: "not found" });
  if (user.email === ADMIN_EMAIL) {
    return res.status(400).json({ error: "cannot remove the admin" });
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(user.id); // frame_access cascades
  res.json({ deleted: true });
});

app.post("/api/admin/access", requireAdmin, (req, res) => {
  const { userId, frameId } = req.body ?? {};
  if (!userId || !frameId) {
    return res.status(400).json({ error: "userId and frameId are required" });
  }
  if (
    !db.prepare("SELECT 1 FROM users WHERE id = ?").get(userId) ||
    !db.prepare("SELECT 1 FROM frames WHERE id = ?").get(frameId)
  ) {
    return res.status(404).json({ error: "user or frame not found" });
  }
  // Each person can access at most one frame: replace any existing grant.
  db.prepare("DELETE FROM frame_access WHERE user_id = ?").run(userId);
  db.prepare(
    "INSERT OR IGNORE INTO frame_access (user_id, frame_id) VALUES (?, ?)"
  ).run(userId, frameId);
  res.json({ ok: true });
});

app.delete("/api/admin/access", requireAdmin, (req, res) => {
  const { userId, frameId } = req.body ?? {};
  if (!userId || !frameId) {
    return res.status(400).json({ error: "userId and frameId are required" });
  }
  db.prepare("DELETE FROM frame_access WHERE user_id = ? AND frame_id = ?").run(
    userId,
    frameId
  );
  res.json({ ok: true });
});

// ── Device protocol (no cookie; identified by ?frame=SLUG + X-Frame-Key) ──────

// Resolve and authenticate a device request; sends an error response and
// returns null on failure, otherwise returns the frame's runtime.
function authDevice(req, res) {
  const slug = req.query.frame;
  if (!slug) {
    res.status(400).json({ error: "frame query param required" });
    return null;
  }
  const frame = db.prepare("SELECT * FROM frames WHERE slug = ?").get(slug);
  if (!frame) {
    res.status(404).json({ error: "unknown frame" });
    return null;
  }
  const key = req.get("X-Frame-Key") ?? "";
  if (!key || sha256(key) !== frame.device_key_hash) {
    res.status(401).json({ error: "bad device key" });
    return null;
  }
  const rt = runtimes.get(slug);
  if (!rt) {
    res.status(503).json({ error: "frame not ready" });
    return null;
  }
  return rt;
}

// Full animation bundle: ANM0, uint32 id, uint16 frameCount, uint16 delayMs,
// then frameCount * 2048 bytes of RGB565 pixels (all little-endian).
app.get("/animation", (req, res) => {
  const rt = authDevice(req, res);
  if (!rt) return;
  const header = Buffer.alloc(12);
  ANIM_MAGIC.copy(header, 0);
  header.writeUInt32LE(rt.animId, 4);
  header.writeUInt16LE(rt.frames.length, 8);
  header.writeUInt16LE(rt.delayMs, 10);
  res.set("Content-Type", "application/octet-stream");
  res.set("Cache-Control", "no-store");
  res.send(Buffer.concat([header, ...rt.frames]));
});

// Long poll: responds "ID <n>\n" as soon as the frame's animation id differs
// from the client's, or after POLL_HOLD_MS with the (unchanged) current id.
app.get("/poll", (req, res) => {
  const rt = authDevice(req, res);
  if (!rt) return;
  const clientId = parseInt(req.query.id, 10) || 0;
  const respond = () => {
    res.set("Content-Type", "text/plain");
    res.set("Cache-Control", "no-store");
    res.send(`ID ${rt.animId}\n`);
  };
  if (rt.animId !== clientId) return respond();
  const timer = setTimeout(() => {
    rt.pollWaiters = rt.pollWaiters.filter((w) => w !== wake);
    respond();
  }, POLL_HOLD_MS);
  const wake = () => {
    clearTimeout(timer);
    respond();
  };
  rt.pollWaiters.push(wake);
  res.on("close", () => {
    clearTimeout(timer);
    rt.pollWaiters = rt.pollWaiters.filter((w) => w !== wake);
  });
});

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(join(__dirname, "dist", "index.html"));
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
