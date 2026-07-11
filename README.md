# AI Pixel Art Frame — Server

Express + React app that generates 32×32 pixel-art animations with Claude and
drives one or more physical [MatrixPortal frames](../firmware). It is
**multi-frame** and **authenticated**: people sign in with Google and control
only the frames assigned to them; the admin manages everything.

## How it works

- Each **frame** has a stable `slug` and a secret **device key**. The board
  fetches `GET /animation?frame=<slug>` (sending the key as an `X-Frame-Key`
  header), plays the animation from RAM, and holds `GET /poll?frame=<slug>&id=N`
  open so new art appears within milliseconds. The active selection and a
  monotonic id are persisted per frame, so a server restart never makes a board
  miss an update.
- Each frame has its **own gallery** of generated animations plus the shared
  presets. Anyone with access to a frame can generate new art on it.
- **Auth:** the browser gets a Google ID token, the server verifies it and
  issues an httpOnly session-cookie JWT. **Only pre-approved emails may sign
  in** — the admin (`ADMIN_EMAIL`) always can; everyone else must first be added
  in the Admin tab.

## Environment

Copy `.env.example` to `.env` and fill it in. `ADMIN_EMAIL` is required;
`GOOGLE_CLIENT_ID` is required for sign-in; `SESSION_SECRET` should be set in
production. See `.env.example` for details.

## Google OAuth setup (one time)

1. [Google Cloud Console](https://console.cloud.google.com/) → create/select a
   project → **APIs & Services → Credentials → Create credentials → OAuth client
   ID** → application type **Web application**.
2. **Authorized JavaScript origins** (exact scheme/host/port, no path):
   - `https://ai-pixel-art-frame.leo.gd` (production)
   - `http://localhost:5173` (Vite dev)
   No redirect URI is needed — this uses the GIS token flow.
3. Configure the **OAuth consent screen** (External). While unverified, add the
   handful of allowed emails as **Test users**.
4. Copy the **Client ID** into `GOOGLE_CLIENT_ID`. The client *secret* is not
   used.

## Run locally

```sh
npm install
npm run dev    # Vite on :5173, proxies /api,/animation,/poll → :3136
npm run start  # Express on :3136 (serves the built dist/ in production)
```

For the dev server, run `npm run start` in one terminal and `npm run dev` in
another; sign-in works on `http://localhost:5173` because it's an authorized
origin.

## Using it

1. Sign in as `ADMIN_EMAIL` → the **Admin** tab appears.
2. **Add a frame** (e.g. "Living Room"). The device key is shown **once** —
   paste its `FRAME_SLUG`/`FRAME_KEY` into that board's `secrets.h` and flash it
   (see [firmware README](../firmware/README.md)). Repeat per board.
3. **Add a person** by email, then tick the frames they may control.
4. Each user signs in and controls their frames; the admin controls all.

## Text messages (marquee)

Type `say hello world` (or `say "hello world"`) in the prompt box and the
frame shows the message as scrolling marquee text instead of generating art —
no AI involved. The server rasterizes the text (5×7 font at 2×, white on
black) into a normal looping animation, so **no firmware changes** are needed.
The message is **saved to the frame's gallery** like a generated animation —
same preview card, tap to reshow, long-press to delete; saying the same text
again reuses its existing card. Messages are capped at 100 characters; the
firmware's 64-frame budget means longer messages scroll more pixels per step.

### Programmatic API

Headless callers (scripts, cron, other servers) can send text without a Google
account using a **service token**, minted in the Admin tab under *Service
tokens*:

```sh
curl -X POST https://ai-pixel-art-frame.leo.gd/api/say \
  -H "Authorization: Bearer svc_..." \
  -H "Content-Type: application/json" \
  -d '{"frame": "living-room", "text": "hello world"}'
```

`frame` is the slug (or the frame's name). API messages are **transient** by
default — shown on the frame (and as a live card in the remote) but not added
to the gallery, so frequent senders don't flood it. Pass `"save": true` to
also keep the message in the gallery. Revoke a token by deleting it in the
Admin tab.

## Deploying

`git push` triggers the GitHub Action that pushes to the DreamCompute VPS,
which builds and restarts the app. Two things the code push does **not** carry:

- **New dependencies** (`google-auth-library`, `jsonwebtoken`, `cookie-parser`):
  the server must `npm install` after this change. If the post-receive hook
  doesn't already run it, SSH in once and run `npm install` in the app dir.
- **Env vars:** set `ADMIN_EMAIL`, `GOOGLE_CLIENT_ID`, and `SESSION_SECRET` in
  the server's environment (the VPS `.env`), then restart. The server exits on
  boot if `ADMIN_EMAIL` is missing.

On first boot the DB migrates automatically: a `default` frame is created and
the existing gallery is attached to it. Its device key is **not** logged (logs
persist on disk) — mint one with **rotate key** in the Admin tab before flashing
a board for it, or rename/delete the default frame there.
