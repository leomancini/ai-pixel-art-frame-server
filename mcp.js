// ── MCP server: control frames, generate animations, switch what's showing ────
//
// Exposes a remote Streamable-HTTP MCP endpoint at POST /mcp so an MCP client
// (e.g. Claude) can list frames, generate animations, and change which
// animation a physical frame is showing. It runs INSIDE the Express process on
// purpose: activating an animation must wake the device's outstanding long-poll
// (via setFrameGallery/setFramePreset, which touch the in-RAM `runtimes` Map),
// and that only works in-process.
//
// Auth is OAuth 2.1 with Google as the upstream login. This server is its own
// authorization server (dynamic client registration, PKCE, token issuance) and
// bounces the browser to Google to establish identity; issued access tokens are
// short-lived JWTs signed with the same SESSION_SECRET as the web session. The
// set of people allowed in is identical to the website's (admin email + any
// pre-provisioned user) and per-frame access reuses the `frame_access` grants.
//
// One deliberate exception: requests that concern the configured anonymous
// slug (default "frame-003") are served WITHOUT a token, so that frame can be
// driven by unauthenticated clients/scripts. Every other frame requires login.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { z } from "zod";

const TOKEN_TTL_SECONDS = 60 * 60; // access-token lifetime; clients refresh past it
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const LOGIN_TX_TTL_MS = 10 * 60 * 1000;
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const randomToken = () => crypto.randomBytes(32).toString("hex");

/**
 * Mount the MCP endpoint and (when Google is configured) its OAuth authorization
 * server onto an existing Express app. Must be called BEFORE the SPA catch-all.
 *
 * deps:
 *   db                  better-sqlite3 handle
 *   presets             the preset map { key: { name, delayMs, frames } }
 *   DEFAULT_PRESET_KEY  fallback preset key
 *   generateAnimation   async (prompt, apiKey?) => { name, frameCount, delayMs, code, frames }
 *   setFrameGallery     (slug, animationRow) => void   (bumps + wakes device)
 *   setFramePreset      (slug, presetKey) => void       (bumps + wakes device)
 *   upsertAuthorizedUser({ email, sub, name }) => userRow | null   (gates the email)
 *   config { baseUrl, googleClientId, googleClientSecret, sessionSecret, anonFrameSlug }
 */
export function mountMcp(app, deps) {
  const {
    db,
    presets,
    DEFAULT_PRESET_KEY,
    generateAnimation,
    setFrameGallery,
    setFramePreset,
    upsertAuthorizedUser,
    config,
  } = deps;

  const ANON_SLUG = config.anonFrameSlug || "frame-003";
  const SESSION_SECRET = config.sessionSecret;
  const BASE_URL = config.baseUrl.replace(/\/+$/, "");
  const MCP_URL = `${BASE_URL}/mcp`;
  const RESOURCE_METADATA_URL = getOAuthProtectedResourceMetadataUrl(new URL(MCP_URL));

  const oauthEnabled = !!(config.googleClientId && config.googleClientSecret);
  if (!oauthEnabled) {
    console.warn(
      "[!] MCP: GOOGLE_CLIENT_SECRET (and GOOGLE_CLIENT_ID) not set — MCP login is " +
        `disabled; only the '${ANON_SLUG}' frame is reachable (unauthenticated).`
    );
  }

  // ── DB tables: registered OAuth clients + issued refresh tokens ─────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_clients (
      client_id TEXT PRIMARY KEY,
      client_info TEXT NOT NULL,            -- JSON OAuthClientInformationFull
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mcp_refresh_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Short-lived state held in RAM (only relevant during an in-flight login).
  const pendingLogins = new Map(); // txId -> { clientId, redirectUri, codeChallenge, state, expiresAt }
  const authCodes = new Map(); // ourCode -> { userId, email, isAdmin, clientId, codeChallenge, redirectUri, expiresAt }
  const sweep = (map) => {
    const now = Date.now();
    for (const [k, v] of map) if (v.expiresAt <= now) map.delete(k);
  };

  const googleVerifier = oauthEnabled ? new OAuth2Client(config.googleClientId) : null;

  // ── Frame lookup + access helpers ───────────────────────────────────────────
  const frameBySlug = (slug) => db.prepare("SELECT * FROM frames WHERE slug = ?").get(slug);

  // Resolve a tool's `frame` argument to a frame row. Accepts the slug, the
  // numeric id, or the display name (case-insensitive) so callers can refer to
  // frames however is natural. Returns { frame } or { error } (the error names
  // the ambiguity when a name matches more than one frame).
  function lookupFrame(frameArg) {
    if (frameArg == null) return { error: "a frame is required (name or slug)" };
    const s = String(frameArg).trim();
    const bySlug = db.prepare("SELECT * FROM frames WHERE slug = ?").get(s);
    if (bySlug) return { frame: bySlug };
    if (/^\d+$/.test(s)) {
      const byId = db.prepare("SELECT * FROM frames WHERE id = ?").get(Number(s));
      if (byId) return { frame: byId };
    }
    const byName = db.prepare("SELECT * FROM frames WHERE lower(name) = lower(?)").all(s);
    if (byName.length === 1) return { frame: byName[0] };
    if (byName.length > 1) {
      return { error: `more than one frame is named "${s}" — use its slug (${byName.map((f) => f.slug).join(", ")})` };
    }
    return { error: `no frame matches "${s}" — list_frames shows the available names and slugs` };
  }

  // The slug a frame argument resolves to (or null), for the gate's anon check.
  const resolveSlug = (frameArg) => lookupFrame(frameArg).frame?.slug ?? null;

  // Resolve + authorize a frame for a tool call. `auth` is the AuthInfo, or
  // undefined for an anonymous caller. Returns { frame } or { error }.
  function resolveFrameForCall(auth, frameArg) {
    const found = lookupFrame(frameArg);
    if (found.error) return { error: found.error };
    const frame = found.frame;
    if (!auth) {
      if (frame.slug !== ANON_SLUG) {
        return { error: `authentication required to control '${frame.slug}'` };
      }
      return { frame };
    }
    const u = auth.extra;
    if (u.isAdmin) return { frame };
    const ok = db
      .prepare("SELECT 1 FROM frame_access WHERE user_id = ? AND frame_id = ?")
      .get(u.uid, frame.id);
    if (!ok) return { error: `you don't have access to '${frame.slug}'` };
    return { frame };
  }

  // The frames a caller may see in list_frames.
  function visibleFrames(auth) {
    if (!auth) {
      const f = frameBySlug(ANON_SLUG);
      return f ? [f] : [];
    }
    const u = auth.extra;
    if (u.isAdmin) return db.prepare("SELECT * FROM frames ORDER BY name").all();
    return db
      .prepare(
        `SELECT f.* FROM frames f
         JOIN frame_access a ON a.frame_id = f.id
         WHERE a.user_id = ? ORDER BY f.name`
      )
      .all(u.uid);
  }

  function activeAnimationLabel(frame) {
    if (frame.active_kind === "gallery" && frame.active_gallery_id != null) {
      const row = db
        .prepare("SELECT name FROM animations WHERE id = ? AND frame_id = ?")
        .get(frame.active_gallery_id, frame.id);
      if (row) return { kind: "gallery", id: frame.active_gallery_id, name: row.name };
    }
    const key =
      frame.active_preset_key && presets[frame.active_preset_key]
        ? frame.active_preset_key
        : DEFAULT_PRESET_KEY;
    return { kind: "preset", preset: key, name: presets[key].name };
  }

  // ── OAuth provider (delegates the actual login to Google) ───────────────────
  const clientsStore = {
    getClient(clientId) {
      const row = db.prepare("SELECT client_info FROM mcp_clients WHERE client_id = ?").get(clientId);
      return row ? JSON.parse(row.client_info) : undefined;
    },
    registerClient(client) {
      // The SDK has already assigned client_id / secret; persist as-is.
      db.prepare(
        "INSERT OR REPLACE INTO mcp_clients (client_id, client_info) VALUES (?, ?)"
      ).run(client.client_id, JSON.stringify(client));
      return client;
    },
  };

  function issueTokens(user, clientId) {
    const access_token = jwt.sign(
      { kind: "mcp", uid: user.id, email: user.email, isAdmin: !!user.is_admin, cid: clientId },
      SESSION_SECRET,
      { expiresIn: TOKEN_TTL_SECONDS }
    );
    const refresh_token = randomToken();
    db.prepare(
      "INSERT INTO mcp_refresh_tokens (token_hash, user_id, client_id) VALUES (?, ?, ?)"
    ).run(sha256(refresh_token), user.id, clientId);
    return {
      access_token,
      token_type: "bearer",
      expires_in: TOKEN_TTL_SECONDS,
      refresh_token,
      scope: "mcp",
    };
  }

  const provider = {
    clientsStore,

    // Step 1: bounce the browser to Google, remembering the client's PKCE
    // challenge + redirect so we can complete the flow on the way back.
    async authorize(client, params, res) {
      sweep(pendingLogins);
      const txId = randomToken();
      pendingLogins.set(txId, {
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        state: params.state,
        expiresAt: Date.now() + LOGIN_TX_TTL_MS,
      });
      const url = new URL(GOOGLE_AUTH_URL);
      url.searchParams.set("client_id", config.googleClientId);
      url.searchParams.set("redirect_uri", `${BASE_URL}/oauth/google/callback`);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", "openid email profile");
      url.searchParams.set("state", txId);
      url.searchParams.set("access_type", "online");
      url.searchParams.set("prompt", "select_account");
      res.redirect(302, url.href);
    },

    // Step 3 (PKCE): the SDK verifies the verifier against this challenge.
    async challengeForAuthorizationCode(client, authorizationCode) {
      const entry = authCodes.get(authorizationCode);
      if (!entry || entry.clientId !== client.client_id) {
        throw new Error("invalid authorization code");
      }
      return entry.codeChallenge;
    },

    async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri) {
      sweep(authCodes);
      const entry = authCodes.get(authorizationCode);
      if (!entry || entry.clientId !== client.client_id) {
        throw new Error("invalid authorization code");
      }
      if (redirectUri && redirectUri !== entry.redirectUri) {
        throw new Error("redirect_uri mismatch");
      }
      authCodes.delete(authorizationCode); // single use
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(entry.userId);
      if (!user) throw new Error("user no longer exists");
      return issueTokens(user, client.client_id);
    },

    async exchangeRefreshToken(client, refreshToken) {
      const row = db
        .prepare("SELECT * FROM mcp_refresh_tokens WHERE token_hash = ?")
        .get(sha256(refreshToken));
      if (!row || row.client_id !== client.client_id) {
        throw new Error("invalid refresh token");
      }
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id);
      if (!user) throw new Error("user no longer exists");
      // Rotate the refresh token.
      db.prepare("DELETE FROM mcp_refresh_tokens WHERE token_hash = ?").run(row.token_hash);
      return issueTokens(user, client.client_id);
    },

    async verifyAccessToken(token) {
      const payload = jwt.verify(token, SESSION_SECRET);
      if (payload.kind !== "mcp") throw new Error("not an MCP token");
      return {
        token,
        clientId: payload.cid,
        scopes: ["mcp"],
        expiresAt: payload.exp,
        extra: { uid: payload.uid, email: payload.email, isAdmin: !!payload.isAdmin },
      };
    },

    async revokeToken(client, request) {
      // Only refresh tokens are stateful; access tokens are short-lived JWTs.
      db.prepare("DELETE FROM mcp_refresh_tokens WHERE token_hash = ?").run(sha256(request.token));
    },
  };

  // ── OAuth authorization-server endpoints (metadata, /authorize, /token, …) ──
  if (oauthEnabled) {
    app.use(
      mcpAuthRouter({
        provider,
        issuerUrl: new URL(BASE_URL),
        baseUrl: new URL(BASE_URL),
        resourceServerUrl: new URL(MCP_URL),
        scopesSupported: ["mcp"],
        resourceName: "AI Pixel Art Frames",
      })
    );

    // Google's redirect back to us: verify identity, gate the email, then hand
    // the MCP client its own authorization code.
    app.get("/oauth/google/callback", async (req, res) => {
      sweep(pendingLogins);
      const tx = pendingLogins.get(String(req.query.state ?? ""));
      if (tx) pendingLogins.delete(String(req.query.state));
      if (!tx) return res.status(400).send("Login session expired — please try connecting again.");

      const bounce = (params) => {
        const url = new URL(tx.redirectUri);
        for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
        if (tx.state) url.searchParams.set("state", tx.state);
        res.redirect(302, url.href);
      };

      if (req.query.error) return bounce({ error: String(req.query.error) });
      const code = req.query.code;
      if (!code) return bounce({ error: "invalid_request" });

      let email, sub, name;
      try {
        const r = await fetch(GOOGLE_TOKEN_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code: String(code),
            client_id: config.googleClientId,
            client_secret: config.googleClientSecret,
            redirect_uri: `${BASE_URL}/oauth/google/callback`,
            grant_type: "authorization_code",
          }),
        });
        if (!r.ok) throw new Error(`google token exchange failed (${r.status})`);
        const tokens = await r.json();
        const ticket = await googleVerifier.verifyIdToken({
          idToken: tokens.id_token,
          audience: config.googleClientId,
        });
        const p = ticket.getPayload();
        if (!p?.email || !p.email_verified) return bounce({ error: "access_denied" });
        email = p.email;
        sub = p.sub;
        name = p.name;
      } catch (e) {
        console.error("[mcp] google callback failed:", e.message);
        return bounce({ error: "server_error" });
      }

      const user = upsertAuthorizedUser({ email, sub, name });
      if (!user) {
        return bounce({ error: "access_denied", error_description: "account not authorized" });
      }

      sweep(authCodes);
      const ourCode = randomToken();
      authCodes.set(ourCode, {
        userId: user.id,
        clientId: tx.clientId,
        codeChallenge: tx.codeChallenge,
        redirectUri: tx.redirectUri,
        expiresAt: Date.now() + AUTH_CODE_TTL_MS,
      });
      bounce({ code: ourCode });
    });
  }

  // ── Bearer gate with the frame-003 anonymous exception ──────────────────────
  //
  // A valid token → authenticated. No token → allowed ONLY for a tools/call that
  // explicitly targets the anonymous slug; everything else — including the
  // `initialize` handshake — gets a 401 pointing at our OAuth metadata. That 401
  // on connect is what makes an interactive client (e.g. Claude) start the
  // Google login flow; without it the client would just connect anonymously and
  // never offer to sign in. The stateless transport serves a bare tools/call
  // without a prior initialize, so a non-interactive client can still drive
  // frame-003 with no token. (An invalid/expired token is also a 401.)

  function messagesOf(body) {
    if (Array.isArray(body)) return body;
    if (body && typeof body === "object") return [body];
    return [];
  }

  // True if this message is safe to serve without a token: only a tools/call
  // aimed at the anonymous frame. Anything else is challenged so the client logs
  // in (an authenticated session then has full, access-checked control).
  function anonAllowed(msg) {
    if (!msg || msg.method !== "tools/call") return false;
    return resolveSlug(msg.params?.arguments?.frame) === ANON_SLUG;
  }

  function challenge(req, res, error) {
    res.set(
      "WWW-Authenticate",
      `Bearer ${error ? `error="${error}", ` : ""}resource_metadata="${RESOURCE_METADATA_URL}"`
    );
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Authentication required" },
      id: (Array.isArray(req.body) ? null : req.body?.id) ?? null,
    });
  }

  async function mcpGate(req, res, next) {
    const m = (req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
    if (m) {
      try {
        req.auth = await provider.verifyAccessToken(m[1]);
        return next();
      } catch {
        return challenge(req, res, "invalid_token");
      }
    }
    // No token: serve only the anonymous-safe subset.
    req.auth = undefined;
    if (messagesOf(req.body).every(anonAllowed)) return next();
    if (!oauthEnabled) {
      return res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "MCP login is not configured on this server" },
        id: (Array.isArray(req.body) ? null : req.body?.id) ?? null,
      });
    }
    return challenge(req, res);
  }

  // ── The MCP server + its tools (built per request, stateless transport) ─────
  function buildServer() {
    const server = new McpServer(
      { name: "ai-pixel-art-frame", version: "0.1.0" },
      {
        instructions:
          "Control physical 32x32 pixel-art LED frames: list frames, generate new " +
          "animations from a text prompt, and choose which animation a frame shows. " +
          "Refer to a frame by its name (e.g. 'Living Room') or its slug (e.g. " +
          "'frame-003'); list_frames shows both.",
      }
    );

    const ok = (text, data) => ({
      content: [{ type: "text", text: data ? `${text}\n${JSON.stringify(data, null, 2)}` : text }],
    });
    const fail = (text) => ({ content: [{ type: "text", text }], isError: true });

    server.registerTool(
      "whoami",
      {
        title: "Who am I",
        description: "Show the authenticated identity for this MCP session (or 'anonymous').",
        inputSchema: {},
      },
      async (_args, extra) => {
        const a = extra.authInfo;
        if (!a) return ok(`anonymous — limited to the '${ANON_SLUG}' frame`);
        return ok(`signed in as ${a.extra.email}${a.extra.isAdmin ? " (admin)" : ""}`, {
          email: a.extra.email,
          isAdmin: a.extra.isAdmin,
        });
      }
    );

    server.registerTool(
      "list_frames",
      {
        title: "List frames",
        description:
          "List the pixel-art frames you can control, with each frame's slug, name, " +
          "and the animation it is currently showing.",
        inputSchema: {},
      },
      async (_args, extra) => {
        const frames = visibleFrames(extra.authInfo).map((f) => ({
          slug: f.slug,
          name: f.name,
          showing: activeAnimationLabel(f),
        }));
        if (!frames.length) return ok("No frames are available to you.");
        return ok(`${frames.length} frame(s):`, frames);
      }
    );

    server.registerTool(
      "list_animations",
      {
        title: "List a frame's animations",
        description:
          "List the animations available on a frame: the shared presets and the frame's " +
          "own AI-generated gallery, marking which one is currently showing. Use the " +
          "returned `galleryId` or `preset` with show_animation.",
        inputSchema: { frame: z.string().describe("the frame's name or slug, e.g. 'Living Room' or 'frame-003'") },
      },
      async ({ frame: frameArg }, extra) => {
        const { frame, error } = resolveFrameForCall(extra.authInfo, frameArg);
        if (error) return fail(error);
        const gallery = db
          .prepare(
            "SELECT id, name, prompt, frame_count, delay_ms, created_at FROM animations WHERE frame_id = ? ORDER BY id DESC"
          )
          .all(frame.id)
          .map((r) => ({
            galleryId: r.id,
            name: r.name,
            prompt: r.prompt,
            frameCount: r.frame_count,
            delayMs: r.delay_ms,
            createdAt: r.created_at,
            active: frame.active_kind === "gallery" && r.id === frame.active_gallery_id,
          }));
        const presetList = Object.entries(presets).map(([key, p]) => ({
          preset: key,
          name: p.name,
          active: frame.active_kind === "preset" && key === frame.active_preset_key,
        }));
        return ok(`Animations for '${frame.slug}':`, {
          showing: activeAnimationLabel(frame),
          presets: presetList,
          gallery,
        });
      }
    );

    server.registerTool(
      "generate_animation",
      {
        title: "Generate an animation",
        description:
          "Generate a brand-new looping animation for a frame from a text prompt (Claude " +
          "writes the pixel-art render code), save it to the frame's gallery, and show it " +
          "immediately. Takes ~10-40s. Returns the new gallery animation's id.",
        inputSchema: {
          frame: z.string().describe("the frame's name or slug, e.g. 'Living Room' or 'frame-003'"),
          prompt: z
            .string()
            .min(1)
            .max(500)
            .describe("what the animation should depict, e.g. 'a flickering campfire'"),
        },
      },
      async ({ frame: frameArg, prompt }, extra) => {
        const { frame, error } = resolveFrameForCall(extra.authInfo, frameArg);
        if (error) return fail(error);
        try {
          const anim = await generateAnimation(prompt.trim(), frame.anthropic_api_key || undefined);
          const blob = Buffer.from(anim.frames.flat());
          const row = db
            .prepare(
              `INSERT INTO animations (prompt, name, code, frame_count, delay_ms, frames, frame_id)
               VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`
            )
            .get(prompt.trim(), anim.name, anim.code, anim.frames.length, anim.delayMs, blob, frame.id);
          setFrameGallery(frame.slug, row); // saves, activates, wakes the device
          return ok(`Generated "${row.name}" and showing it on '${frame.slug}'.`, {
            galleryId: row.id,
            name: row.name,
            frameCount: row.frame_count,
            delayMs: row.delay_ms,
          });
        } catch (e) {
          return fail(`generation failed: ${e.message}`);
        }
      }
    );

    server.registerTool(
      "show_animation",
      {
        title: "Show an animation",
        description:
          "Change which animation a frame is showing. Provide exactly one of `galleryId` " +
          "(an AI-generated animation from the frame's gallery) or `preset` (a shared preset " +
          "key). The physical frame updates within a second.",
        inputSchema: {
          frame: z.string().describe("the frame's name or slug, e.g. 'Living Room' or 'frame-003'"),
          galleryId: z.number().int().optional().describe("a gallery animation id from list_animations"),
          preset: z.string().optional().describe("a preset key, e.g. 'plasma', 'starfield'"),
        },
      },
      async ({ frame: frameArg, galleryId, preset }, extra) => {
        const { frame, error } = resolveFrameForCall(extra.authInfo, frameArg);
        if (error) return fail(error);
        if ((galleryId == null) === (preset == null)) {
          return fail("provide exactly one of `galleryId` or `preset`");
        }
        if (preset != null) {
          if (!presets[preset]) {
            return fail(`unknown preset '${preset}' (have: ${Object.keys(presets).join(", ")})`);
          }
          setFramePreset(frame.slug, preset);
          return ok(`'${frame.slug}' is now showing the "${presets[preset].name}" preset.`);
        }
        const row = db
          .prepare("SELECT * FROM animations WHERE id = ? AND frame_id = ?")
          .get(galleryId, frame.id);
        if (!row) return fail(`no gallery animation #${galleryId} on '${frame.slug}'`);
        setFrameGallery(frame.slug, row);
        return ok(`'${frame.slug}' is now showing "${row.name}".`);
      }
    );

    return server;
  }

  // ── Streamable-HTTP endpoint (stateless: a fresh server/transport per call) ──
  app.post("/mcp", mcpGate, async (req, res) => {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error("[mcp] request failed:", e);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Stateless mode has no server-initiated streams or sessions to tear down.
  const methodNotAllowed = (req, res) =>
    res.status(405).set("Allow", "POST").json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed — use POST" },
      id: null,
    });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  console.log(
    `[mcp] endpoint at ${MCP_URL} — ${oauthEnabled ? "Google OAuth enabled" : "OAuth disabled"}; ` +
      `'${ANON_SLUG}' is reachable unauthenticated`
  );
}
