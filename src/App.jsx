import React, { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { api, setUnauthorizedHandler } from "./api";
import { Page, Centered, Muted, Input, Header, DangerButton, GhostButton } from "./ui";
import Login from "./Login";
import FrameControl from "./FrameControl";
import AdminPanel from "./AdminPanel";

const Settings = styled.div`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 56px;
  width: min(1100px, 92vw);
  text-align: left;
  /* Admin settings: a little more breathing room below the header. */
  margin-top: ${(p) => (p.$wide ? "24px" : "0")};
`;

// Hosts the frame view and keeps it mounted while in settings (hidden, not
// unmounted) so the gallery grids don't re-fetch/redraw — no flash on the way
// back. display: contents so it doesn't add a box to the page's flex layout.
const FrameHost = styled.div`
  display: ${(p) => (p.$hidden ? "none" : "contents")};
`;

const SettingsList = styled.div`
  display: flex;
  flex-direction: column;
`;

const SettingRow = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 14px;
  padding: 16px 0;
  &:first-child {
    padding-top: 0;
  }
`;

const RowLabel = styled.div`
  color: #777;
  text-align: left;
`;

const RowValue = styled.div`
  width: 100%;
  color: #eee;
  text-align: left;
  overflow-wrap: anywhere;
`;

// Extra space above Log out so it reads as its own section — combined with the
// row paddings (16px + 16px) this makes a 56px gap, matching the section gap.
const LogoutRow = styled(SettingRow)`
  margin-top: 24px;
`;

const LogoutButton = styled(DangerButton)`
  width: 100%;
  @media (min-width: 641px) {
    width: auto;
  }
`;

const Spacer = styled.div`
  flex: 1;
`;

// Frame switcher in the header (admin). Looks like the FrameLabel from the user
// view — big text, no border or background — with the arrow inline right after
// the name. Every name is stacked into one grid cell so the control is always
// as wide as the longest frame name (it never resizes when switching). An
// invisible native <select> is layered over the whole control, so a tap
// anywhere opens the OS frame picker.
const FrameSwitcher = styled.div`
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
`;

const LabelStack = styled.span`
  display: inline-grid;
`;

const StackRow = styled.span`
  grid-area: 1 / 1;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  visibility: ${(p) => (p.$current ? "visible" : "hidden")};
`;

const FrameSwitcherLabel = styled.span`
  font-size: 40px;
  color: #eee;
  white-space: nowrap;
`;

const HeaderArrow = styled.span`
  flex: none;
  pointer-events: none;
  color: #888;
  font-size: 24px;
  text-transform: none;
  transform: translateY(-2px);
`;

const HiddenSelect = styled.select`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  /* Drives the size of the native popup option text. */
  font-size: 24px;
  & option {
    font-size: 24px;
  }
`;

const FrameLabel = styled.div`
  flex: 1;
  min-width: 0;
  font-size: 40px;
  color: ${(p) => (p.$loading ? "#555" : "#eee")};
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const IconButton = styled.button`
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  padding: 0;
  color: ${(p) => (p.$active ? "#111" : "#bbb")};
  background: ${(p) => (p.$active ? "#fff" : "#1d1d1d")};
  border: none;
  border-radius: 10px;
  cursor: pointer;
  @media (hover: hover) {
    &:not(:disabled):hover {
      color: ${(p) => (p.$active ? "#111" : "#fff")};
      background: ${(p) => (p.$active ? "#fff" : "#2e2e2e")};
    }
  }
  &:not(:disabled):active {
    color: ${(p) => (p.$active ? "#111" : "#fff")};
    background: ${(p) => (p.$active ? "#ddd" : "#3a3a3a")};
  }
`;

const GearIcon = () => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const NickForm = styled.form`
  display: flex;
  width: 100%;
  /* Desktop: two homepage grid columns (2 col widths + the 24px gap between).
     min() of flat calc()s — nesting min() inside a calc division breaks iOS. */
  @media (min-width: 641px) {
    width: min(538px, calc((92vw - 72px) / 2 + 24px));
  }
`;

// Lets a user rename a frame they can access. Auto-saves (debounced) as they
// type. This is just the display label — the firmware keys off the slug.
function FrameName({ frame, onSaved }) {
  const [name, setName] = useState(frame.name);
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      return;
    }
    if (!name.trim()) return; // name is required; don't save empty
    const t = setTimeout(() => {
      api
        .patch(`/api/frames/${frame.id}/name`, { name: name.trim() })
        .then(() => onSaved?.());
    }, 500);
    return () => clearTimeout(t);
  }, [name, frame.id, onSaved]);
  return (
    <NickForm onSubmit={(e) => e.preventDefault()}>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Frame name"
        maxLength={60}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        data-1p-ignore="true"
        data-lpignore="true"
      />
    </NickForm>
  );
}

const ApiKeyForm = styled.form`
  display: flex;
  align-items: stretch;
  gap: 10px;
  width: 100%;
  /* Two homepage grid columns — keys are long and there's a Remove button. */
  @media (min-width: 641px) {
    width: min(538px, calc((92vw - 72px) / 2 + 24px));
  }
`;

const ApiKeyInput = styled(Input)`
  flex: 1;
  min-width: 0;
`;

const FieldError = styled.div`
  margin-top: 14px;
  font-size: 16px;
  color: #ff3030;
  text-align: left;
`;

// Lets a user set their own Anthropic API key for a frame they can access,
// overriding the system key for that frame's generations. The key is write-only:
// the server never returns it, so the field stays empty and the placeholder
// notes when one is already saved. Paste a key to save (debounced); Remove
// clears it and reverts the frame to the system key.
function ApiKeyField({ frame, onSaved }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      return;
    }
    const key = value.trim();
    if (!key) return; // empty: nothing to save — use Remove to clear an existing key
    const t = setTimeout(() => {
      setError("");
      api
        .patch(`/api/frames/${frame.id}/api-key`, { apiKey: key })
        .then(() => {
          setValue("");
          onSaved?.();
        })
        .catch((e) => setError(e.message));
    }, 600);
    return () => clearTimeout(t);
  }, [value, frame.id, onSaved]);
  const remove = () => {
    setError("");
    api
      .del(`/api/frames/${frame.id}/api-key`)
      .then(() => onSaved?.())
      .catch((e) => setError(e.message));
  };
  return (
    <div style={{ width: "100%" }}>
      <ApiKeyForm onSubmit={(e) => e.preventDefault()}>
        <ApiKeyInput
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={
            frame.hasApiKey
              ? `Using your key …${frame.apiKeyHint} — paste a new one to replace`
              : "SK-ANT..."
          }
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          data-1p-ignore="true"
          data-lpignore="true"
        />
        {frame.hasApiKey && (
          <GhostButton type="button" onClick={remove}>
            Remove
          </GhostButton>
        )}
      </ApiKeyForm>
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}

// Map the URL path to a view so /settings survives a refresh.
const pathToView = (p) => (p === "/settings" ? "settings" : "frames");

function Main({ user }) {
  const [frames, setFrames] = useState(null);
  const [selectedId, setSelectedId] = useState(() => {
    const saved = localStorage.getItem("selectedFrameId");
    return saved ? Number(saved) : null;
  });
  const [view, setView] = useState(() => pathToView(window.location.pathname));
  const [showLoading, setShowLoading] = useState(false);
  const [adminReady, setAdminReady] = useState(false);

  // The current view is "loading" until all of its data is ready (so we render
  // nothing — just the loading title — instead of flashing partial UI).
  const loading =
    frames === null || (view === "settings" && user.isAdmin && !adminReady);

  // Re-wait for admin data each time we (re)enter the settings view.
  useEffect(() => {
    if (view !== "settings") setAdminReady(false);
  }, [view]);

  // Only surface "Loading" if loading takes more than a second.
  useEffect(() => {
    if (!loading) {
      setShowLoading(false);
      return;
    }
    const t = setTimeout(() => setShowLoading(true), 1000);
    return () => clearTimeout(t);
  }, [loading]);

  // Switch view and keep the URL (/ or /settings) in sync for refresh + back/fwd.
  const goto = useCallback((v) => {
    setView(v);
    const path = v === "settings" ? "/settings" : "/";
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
  }, []);

  useEffect(() => {
    const onPop = () => setView(pathToView(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const loadFrames = useCallback(
    () =>
      api.get("/api/frames").then((fs) => {
        setFrames(fs);
        setSelectedId((cur) =>
          cur && fs.some((f) => f.id === cur) ? cur : fs[0]?.id ?? null
        );
      }),
    []
  );
  useEffect(() => {
    loadFrames();
  }, [loadFrames]);

  // Remember the admin's selected frame across refreshes.
  useEffect(() => {
    if (user.isAdmin && selectedId != null) {
      localStorage.setItem("selectedFrameId", String(selectedId));
    }
  }, [selectedId, user.isAdmin]);

  const logout = async () => {
    await api.post("/api/auth/logout");
    window.location.href = "/"; // back to root, not /settings
  };

  const selected = frames?.find((f) => f.id === selectedId) ?? null;

  // Reflect the current frame in the browser tab title.
  useEffect(() => {
    document.title = (selected?.name || "AI Pixel Art Frame").toUpperCase();
  }, [selected?.name]);

  // Admin switches frames with a header dropdown (instead of tabs).
  const showFrameDropdown =
    view !== "settings" && user.isAdmin && frames && frames.length > 0;

  return (
    <Page>
      <Header $wide={user.isAdmin}>
        {showFrameDropdown ? (
          <>
            <FrameSwitcher>
              <LabelStack>
                {frames.map((f) => (
                  <StackRow key={f.id} $current={f.id === selectedId}>
                    <FrameSwitcherLabel>{f.name}</FrameSwitcherLabel>
                    <HeaderArrow>v</HeaderArrow>
                  </StackRow>
                ))}
              </LabelStack>
              <HiddenSelect
                aria-label="Switch frame"
                value={selectedId ?? ""}
                onChange={(e) => {
                  setSelectedId(Number(e.target.value));
                  e.target.blur();
                }}
              >
                {frames.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </HiddenSelect>
            </FrameSwitcher>
            <Spacer />
          </>
        ) : (
          <FrameLabel $loading={loading && showLoading}>
            {loading
              ? showLoading
                ? "Loading"
                : ""
              : view === "settings"
              ? user.isAdmin
                ? "Admin Settings"
                : "Settings"
              : selected
              ? selected.name
              : ""}
          </FrameLabel>
        )}
        <IconButton
          $active={view === "settings"}
          onClick={() => goto(view === "settings" ? "frames" : "settings")}
          aria-label="Settings"
          title="Settings"
        >
          <GearIcon />
        </IconButton>
      </Header>

      {view === "settings" && frames !== null && (
        <Settings $wide={user.isAdmin}>
          {user.isAdmin && (
            <AdminPanel
              onReady={() => setAdminReady(true)}
              onFramesChanged={loadFrames}
            />
          )}
          {(!user.isAdmin || adminReady) && (
            <SettingsList>
              {/* Per-frame name + API key fields are for non-admin users only;
                  admins manage frames in the panel above. */}
              {!user.isAdmin &&
                frames?.length > 0 &&
                frames.map((f) => (
                  <React.Fragment key={f.id}>
                    <SettingRow>
                      <RowLabel>Frame name</RowLabel>
                      <FrameName frame={f} onSaved={loadFrames} />
                    </SettingRow>
                    <SettingRow>
                      <RowLabel>
                        Anthropic API key
                        {frames.length > 1 ? ` · ${f.name}` : ""}
                      </RowLabel>
                      <ApiKeyField frame={f} onSaved={loadFrames} />
                    </SettingRow>
                  </React.Fragment>
                ))}
              {/* Account sits just above Log out. */}
              <SettingRow>
                <RowLabel>Account</RowLabel>
                <RowValue>{user.email}</RowValue>
              </SettingRow>
              <LogoutRow>
                <LogoutButton onClick={logout}>Log out</LogoutButton>
              </LogoutRow>
            </SettingsList>
          )}
        </Settings>
      )}

      {view !== "settings" && frames !== null && frames.length === 0 && (
        <Muted>
          No frames assigned to you yet.
          {user.isAdmin ? " Add one in Settings (gear, top right)." : " Ask the admin for access."}
        </Muted>
      )}

      {/* Kept mounted across settings toggles (hidden, not unmounted) so the
          gallery grids stay stable — no reload/flash returning to the frame. */}
      {frames && frames.length > 0 && selected && (
        <FrameHost $hidden={view === "settings"}>
          <FrameControl key={selected.id} frame={selected} refresh={loadFrames} />
        </FrameHost>
      )}
    </Page>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [fontReady, setFontReady] = useState(false);

  const loadMe = useCallback(
    () => api.get("/api/me").then(setUser).catch(() => setUser(null)),
    []
  );
  // After signing in, always land on the frames view (not /settings).
  const onSignedIn = useCallback(() => {
    window.history.replaceState({}, "", "/");
    loadMe();
  }, [loadMe]);
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    loadMe();
  }, [loadMe]);

  // Don't render any text until the pixel font is loaded (avoids a fallback flash).
  useEffect(() => {
    let cancelled = false;
    const done = () => !cancelled && setFontReady(true);
    const fonts = document.fonts;
    if (fonts?.load) {
      fonts
        .load('20px "Analog Mono Plus"')
        .then(() => fonts.ready)
        .then(done, done);
    } else {
      done();
    }
    return () => {
      cancelled = true;
    };
  }, []);

  if (!fontReady || user === undefined) {
    // Plain black page until the font is loaded and we know the auth state.
    return <Centered />;
  }
  if (!user) return <Login onSignedIn={onSignedIn} />;
  return <Main user={user} />;
}
