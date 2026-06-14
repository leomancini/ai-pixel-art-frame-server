import React, { useCallback, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { api, setUnauthorizedHandler } from "./api";
import { Page, Centered, Muted, Tab, GhostButton, Input, Header } from "./ui";
import Login from "./Login";
import FrameControl from "./FrameControl";
import AdminPanel from "./AdminPanel";

const Settings = styled.div`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 24px;
  width: ${(p) => (p.$wide ? "min(1100px, 92vw)" : "min(560px, 92vw)")};
  text-align: left;
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

const LogoutButton = styled(GhostButton)`
  width: 100%;
  color: #ff5555;
  border-color: #ff5555;
`;

const FrameLabel = styled.div`
  flex: 1;
  min-width: 0;
  font-size: 40px;
  color: #eee;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const IconButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  color: ${(p) => (p.$active ? "#111" : "#bbb")};
  background: ${(p) => (p.$active ? "#fff" : "#1d1d1d")};
  border: none;
  border-radius: 10px;
  cursor: pointer;
`;

const GearIcon = () => (
  <svg
    width="20"
    height="20"
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

// Map the URL path to a view so /settings survives a refresh.
const pathToView = (p) => (p === "/settings" ? "settings" : "frames");

function Main({ user }) {
  const [frames, setFrames] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [view, setView] = useState(() => pathToView(window.location.pathname));

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

  const logout = async () => {
    await api.post("/api/auth/logout");
    window.location.href = "/"; // back to root, not /settings
  };

  const selected = frames?.find((f) => f.id === selectedId) ?? null;

  return (
    <Page>
      <Header $wide={user.isAdmin}>
        <FrameLabel>
          {frames === null ? "Loading…" : selected ? selected.name : ""}
        </FrameLabel>
        <IconButton
          $active={view === "settings"}
          onClick={() => goto(view === "settings" ? "frames" : "settings")}
          aria-label="Settings"
          title="Settings"
        >
          <GearIcon />
        </IconButton>
      </Header>

      {view === "settings" ? (
        <Settings $wide={user.isAdmin}>
          <SettingsList>
            <SettingRow>
              <RowLabel>Account</RowLabel>
              <RowValue>{user.email}</RowValue>
            </SettingRow>
            {!user.isAdmin &&
              frames?.length > 0 &&
              frames.map((f) => (
                <SettingRow key={f.id}>
                  <RowLabel>Frame name</RowLabel>
                  <FrameName frame={f} onSaved={loadFrames} />
                </SettingRow>
              ))}
            <SettingRow>
              <LogoutButton onClick={logout}>Log out</LogoutButton>
            </SettingRow>
          </SettingsList>
          {user.isAdmin && <AdminPanel onFramesChanged={loadFrames} />}
        </Settings>
      ) : frames === null ? null : frames.length === 0 ? (
        <Muted>
          No frames assigned to you yet.
          {user.isAdmin ? " Add one in Settings (gear, top right)." : " Ask the admin for access."}
        </Muted>
      ) : (
        <>
          {frames.length > 1 && (
            <Header $wide={user.isAdmin}>
              {frames.map((f) => (
                <Tab
                  key={f.id}
                  $active={f.id === selectedId}
                  onClick={() => setSelectedId(f.id)}
                >
                  {f.name}
                </Tab>
              ))}
            </Header>
          )}
          {selected && (
            <FrameControl key={selected.id} frame={selected} refresh={loadFrames} />
          )}
        </>
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
