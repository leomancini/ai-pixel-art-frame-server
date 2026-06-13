import React, { useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import { api, setUnauthorizedHandler } from "./api";
import { Page, Centered, Muted, Tab, GhostButton } from "./ui";
import Login from "./Login";
import FrameControl from "./FrameControl";
import AdminPanel from "./AdminPanel";

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
  width: min(1100px, 92vw);
`;

const Spacer = styled.div`
  flex: 1;
`;

const Who = styled.div`
  font-size: 13px;
  color: #888;
`;

function Main({ user }) {
  const [frames, setFrames] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [view, setView] = useState("frames"); // "frames" | "admin"

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
    window.location.reload();
  };

  const selected = frames?.find((f) => f.id === selectedId) ?? null;

  return (
    <Page>
      <Header>
        {user.isAdmin && (
          <>
            <Tab $active={view === "frames"} onClick={() => setView("frames")}>
              Frames
            </Tab>
            <Tab $active={view === "admin"} onClick={() => setView("admin")}>
              Admin
            </Tab>
          </>
        )}
        <Spacer />
        <Who>{user.email}</Who>
        <GhostButton onClick={logout}>Sign out</GhostButton>
      </Header>

      {view === "admin" && user.isAdmin ? (
        <AdminPanel onFramesChanged={loadFrames} />
      ) : frames === null ? (
        <Muted>Loading…</Muted>
      ) : frames.length === 0 ? (
        <Muted>
          No frames assigned to you yet.
          {user.isAdmin ? " Add one in the Admin tab." : " Ask the admin for access."}
        </Muted>
      ) : (
        <>
          {frames.length > 1 && (
            <Header>
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

  const loadMe = useCallback(
    () => api.get("/api/me").then(setUser).catch(() => setUser(null)),
    []
  );
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    loadMe();
  }, [loadMe]);

  if (user === undefined) {
    return (
      <Centered>
        <Muted>Loading…</Muted>
      </Centered>
    );
  }
  if (!user) return <Login onSignedIn={loadMe} />;
  return <Main user={user} />;
}
