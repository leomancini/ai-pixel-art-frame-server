import React, { useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { api } from "./api";
import { Centered, Title, Muted } from "./ui";

const ButtonHost = styled.div`
  min-height: 44px;
`;

const Error = styled.div`
  font-size: 14px;
  color: #ff6b6b;
  max-width: 320px;
  text-align: center;
`;

// Renders the Google Identity Services button, exchanges the returned ID
// token for a session, then calls onSignedIn().
export default function Login({ onSignedIn }) {
  const hostRef = useRef(null);
  const [error, setError] = useState("");

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
      <Title>AI Pixel Art Frame</Title>
      <Muted>Sign in to control your frames.</Muted>
      <ButtonHost ref={hostRef} />
      {error && <Error>{error}</Error>}
    </Centered>
  );
}
