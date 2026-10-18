import React, { useCallback, useEffect, useState } from "react";
import styled from "styled-components";
import { api, setPublicKey, setUnauthorizedHandler } from "./api";
import { Page, Header, Centered, Muted, Title } from "./ui";
import FrameControl from "./FrameControl";

// Public link mode — the page a visitor lands on after scanning a frame's QR
// code: /f/<slug>?key=<key>. No sign-in; the key in the URL is the credential
// and rides along on every API call (see api.js). The admin switches this on
// per frame in Admin Settings; turning it off (or rotating the key) kills the
// link, and this page then shows "This link isn't active."

// Parse a public link path. Returns { slug, key } or null when this isn't one.
export function parsePublicRoute(pathname, search) {
  const m = pathname.match(/^\/f\/([^/]+)\/?$/);
  if (!m) return null;
  const key = new URLSearchParams(search).get("key") ?? "";
  return { slug: decodeURIComponent(m[1]), key };
}

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

const Dead = styled(Muted)`
  max-width: 360px;
`;

export default function PublicFrame({ route }) {
  // undefined = loading, null = dead link (off, rotated, or wrong), else frame
  const [frame, setFrame] = useState(undefined);

  const load = useCallback(
    () =>
      api
        .get(`/api/public/frames/${encodeURIComponent(route.slug)}`)
        .then(setFrame)
        .catch(() => setFrame(null)),
    [route.slug]
  );

  useEffect(() => {
    setPublicKey(route.key);
    // A 401 here means the link went dead mid-session (not "please sign in").
    setUnauthorizedHandler(() => setFrame(null));
    load();
  }, [route.key, load]);

  useEffect(() => {
    document.title = (frame?.name || "AI Pixel Art Frame").toUpperCase();
  }, [frame?.name]);

  if (frame === undefined) return <Centered />;
  if (frame === null) {
    return (
      <Centered>
        <Title>AI Pixel Art Frame</Title>
        <Dead>This link isn't active.</Dead>
      </Centered>
    );
  }
  return (
    <Page>
      <Header>
        <FrameLabel>{frame.name}</FrameLabel>
      </Header>
      <FrameControl key={frame.id} frame={frame} refresh={load} publicMode />
    </Page>
  );
}
