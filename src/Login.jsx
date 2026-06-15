import React, { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { api } from "./api";
import { Centered, Title } from "./ui";

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
  box-sizing: border-box;
  height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: min(560px, 92vw);
  @media (min-width: 641px) {
    width: auto;
  }
  padding: 0 20px;
  color: #111;
  background: #fff;
  border: 2px solid #fff;
  border-radius: 10px;
  cursor: pointer;
  white-space: nowrap;
  &:not(:disabled):active {
    background: #ccc;
    border-color: #ccc;
  }
  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

const Error = styled.div`
  font-size: 20px;
  color: #bbb;
  max-width: 320px;
  text-align: center;
`;

// Custom Start button → Google OAuth token flow (a real user click opens the
// popup; no FedCM, no rendered Google button). The access token is verified
// server-side, which issues our session cookie.
export default function Login({ onSignedIn }) {
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const tokenClientRef = useRef(null);

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
          if (!window.google?.accounts?.oauth2) {
            setTimeout(init, 100); // GIS script still loading
            return;
          }
          tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
            client_id: googleClientId,
            scope: "openid email profile",
            callback: async (resp) => {
              if (resp.error || !resp.access_token) {
                setSigningIn(false);
                setError(resp.error || "sign-in failed");
                return;
              }
              try {
                await api.post("/api/auth/google-token", {
                  accessToken: resp.access_token,
                });
                onSignedIn();
              } catch (e) {
                setSigningIn(false);
                setError(e.message);
              }
            },
            error_callback: () => setSigningIn(false), // popup closed/cancelled
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

  const signIn = () => {
    if (!tokenClientRef.current) return;
    setError("");
    tokenClientRef.current.requestAccessToken(); // must run in the click gesture
    setSigningIn(true);
  };

  // While signing in, show the plain loading screen — never the start screen.
  if (signingIn) {
    return <Centered />;
  }

  return (
    <Centered>
      <Title>
        AI Pixel <MobileBreak />Art Frame
      </Title>
      <SignInButton onClick={signIn} disabled={!ready}>
        Start
      </SignInButton>
      {error && <Error>{error}</Error>}
    </Centered>
  );
}
