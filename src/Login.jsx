import React, { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { api } from "./api";
import { Centered, Title } from "./ui";

// Google's renderButton draws an un-styleable iframe. We render it hidden and
// forward clicks from our own pixel-font button so the real ID-token flow runs.
const HiddenGoogle = styled.div`
  position: absolute;
  opacity: 0;
  pointer-events: none;
  width: 0;
  height: 0;
  overflow: hidden;
`;

// Breaks "AI Pixel / Art Frame" onto two lines on mobile only.
const MobileBreak = styled.br`
  display: none;
  @media (max-width: 640px) {
    display: block;
  }
`;

const SignInButton = styled.button`
  font-family: var(--pixel-font);
  font-size: 20px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 14px 28px;
  color: #111;
  background: #eee;
  border: 2px solid #fff;
  border-radius: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: transform 0.06s ease;
  &:active {
    transform: scale(0.96);
  }
  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

const Error = styled.div`
  font-size: 20px;
  color: #ccc;
  max-width: 320px;
  text-align: center;
`;

// Renders the Google Identity Services button, exchanges the returned ID
// token for a session, then calls onSignedIn().
export default function Login({ onSignedIn }) {
  const hostRef = useRef(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  // Click the real (hidden) Google button to launch the popup; fall back to
  // One Tap if the rendered button isn't there yet.
  const signIn = () => {
    const btn = hostRef.current?.querySelector("div[role=button]");
    if (btn) btn.click();
    else window.google?.accounts?.id?.prompt();
  };

  useEffect(() => {
    let cancelled = false;
    api
      .get("/api/config")
      .then(({ googleClientId }) => {
        if (cancelled) return;
        if (!googleClientId) {
          setError("Sign-in isn't configured yet (no GOOGLE_CLIENT_ID).");
          return;
        }
        const init = () => {
          if (cancelled) return;
          if (!window.google?.accounts?.id) {
            setTimeout(init, 100); // GIS script still loading
            return;
          }
          window.google.accounts.id.initialize({
            client_id: googleClientId,
            callback: async (resp) => {
              try {
                await api.post("/api/auth/google", { credential: resp.credential });
                onSignedIn();
              } catch (e) {
                setError(e.message);
              }
            },
          });
          window.google.accounts.id.renderButton(hostRef.current, {
            theme: "filled_black",
            size: "large",
            text: "signin_with",
            shape: "pill",
          });
          setReady(true);
        };
        init();
      })
      .catch((e) => setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [onSignedIn]);

  return (
    <Centered>
      <Title>
        AI Pixel <MobileBreak />Art Frame
      </Title>
      <SignInButton onClick={signIn} disabled={!ready}>
        Start
      </SignInButton>
      <HiddenGoogle ref={hostRef} />
      {error && <Error>{error}</Error>}
    </Centered>
  );
}
