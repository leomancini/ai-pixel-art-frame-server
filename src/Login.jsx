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
  border-radius: 12px;
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

// Renders the Google Identity Services button, exchanges the returned ID
// token for a session, then calls onSignedIn().
export default function Login({ onSignedIn }) {
  const hostRef = useRef(null);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const authStartedRef = useRef(false); // true once Google returns a credential

  // Click the real (hidden) Google button to launch the popup. We avoid the
  // One Tap / prompt() path because it relies on FedCM, which fails when the
  // user has it disabled. Show the loading screen immediately so the start
  // page never reappears during sign-in.
  const signIn = () => {
    authStartedRef.current = false;
    setError("");
    const btn = hostRef.current?.querySelector(
      'div[role="button"], [role="button"], button'
    );
    if (!btn) {
      setError("Sign-in isn't ready yet — please try again.");
      return;
    }
    btn.click();
    setSigningIn(true);
  };

  // If the user dismisses the Google popup without authenticating, focus
  // returns here with no auth started — restore the start screen.
  useEffect(() => {
    const onFocus = () => {
      window.setTimeout(() => {
        if (!authStartedRef.current) setSigningIn(false);
      }, 500);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

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
              // Auth started — keep the loading screen up through the exchange.
              authStartedRef.current = true;
              setSigningIn(true);
              try {
                await api.post("/api/auth/google", { credential: resp.credential });
                onSignedIn();
              } catch (e) {
                authStartedRef.current = false;
                setSigningIn(false);
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

  // While signing in, show the plain loading screen (same as the app's initial
  // load) — never the start screen.
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
      <HiddenGoogle ref={hostRef} />
      {error && <Error>{error}</Error>}
    </Centered>
  );
}
