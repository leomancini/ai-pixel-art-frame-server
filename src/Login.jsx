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

// Holds the real Google Identity Services button. It must be genuinely visible
// and clicked by the user — a programmatic click is rejected by GIS, and the
// One Tap / FedCM path fails when FedCM is disabled, so we render the actual
// button and let the user click it (popup flow, no FedCM dependency).
const GoogleHost = styled.div`
  min-height: 44px;
  display: flex;
  justify-content: center;
`;

const Error = styled.div`
  font-size: 20px;
  color: #bbb;
  max-width: 320px;
  text-align: center;
`;

// Renders the Google sign-in button, exchanges the returned ID token for a
// session, then calls onSignedIn().
export default function Login({ onSignedIn }) {
  const hostRef = useRef(null);
  const [error, setError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

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
          if (cancelled || !hostRef.current) return;
          if (!window.google?.accounts?.id) {
            setTimeout(init, 100); // GIS script still loading
            return;
          }
          window.google.accounts.id.initialize({
            client_id: googleClientId,
            callback: async (resp) => {
              setSigningIn(true); // swap to loading while we exchange the token
              try {
                await api.post("/api/auth/google", {
                  credential: resp.credential,
                });
                onSignedIn();
              } catch (e) {
                setSigningIn(false);
                setError(e.message);
              }
            },
          });
          window.google.accounts.id.renderButton(hostRef.current, {
            theme: "filled_black",
            size: "large",
            text: "continue_with",
            shape: "pill",
            width: 280,
          });
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
      <GoogleHost ref={hostRef} />
      {error && <Error>{error}</Error>}
    </Centered>
  );
}
