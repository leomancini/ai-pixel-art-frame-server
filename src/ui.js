// Shared styled-components for the dark pixel-frame aesthetic.
//
// TYPOGRAPHY RULE (Analog Mono Plus pixel font):
//   - Recommended font size: 20px, or multiples (20, 40, 60, 80, …) ONLY.
//   - Anti-aliasing must stay DISABLED for crisp pixels (see index.css).
// Don't introduce off-grid sizes — they render blurry.
import styled from "styled-components";

export const Page = styled.div`
  box-sizing: border-box;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
  /* Pad for the status bar / home indicator since the status bar is now
     translucent and the web view spans the full screen. env() is 0 in a
     desktop browser, so the base 16px / 48px is unchanged there. */
  padding: 16px;
  padding-top: calc(16px + env(safe-area-inset-top));
  padding-right: calc(16px + env(safe-area-inset-right));
  padding-bottom: calc(16px + env(safe-area-inset-bottom));
  padding-left: calc(16px + env(safe-area-inset-left));
  background: #000;
  color: #eee;
  font-family: var(--pixel-font);
  @media (min-width: 641px) {
    padding-top: calc(48px + env(safe-area-inset-top));
    padding-bottom: calc(48px + env(safe-area-inset-bottom));
  }
`;

export const Centered = styled.div`
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 40px;
  padding: env(safe-area-inset-top) env(safe-area-inset-right)
    env(safe-area-inset-bottom) env(safe-area-inset-left);
  box-sizing: border-box;
  background: #000;
  color: #eee;
  font-family: var(--pixel-font);
`;

export const Muted = styled.div`
  font-size: 20px;
  color: #777;
  text-align: center;
`;

export const Title = styled.h1`
  font-size: 40px;
  font-weight: normal;
  margin: 0;
`;

export const SectionTitle = styled.h2`
  font-size: 20px;
  font-weight: normal;
  color: #999;
  margin: 0 0 4px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
`;

export const Input = styled.input.attrs({
  "data-1p-ignore": "",
  "data-lpignore": "true",
})`
  flex: 1;
  min-width: 0;
  box-sizing: border-box;
  height: 48px;
  padding: 12px 16px;
  font-size: 20px;
  color: #eee;
  background: #111111;
  border: 2px solid #444;
  border-radius: 10px;
  outline: none;
  resize: none;
  text-align: left;
  @media (hover: hover) {
    &:not(:disabled):hover {
      border-color: #888;
    }
  }
  &:focus {
    border-color: #888;
  }
  &:disabled {
    opacity: 1;
    color: #eee;
    -webkit-text-fill-color: #eee;
  }
  &::placeholder,
  &:disabled::placeholder {
    color: #555;
    -webkit-text-fill-color: #555;
    opacity: 1;
  }
`;

export const Select = styled.select`
  box-sizing: border-box;
  height: 48px;
  padding: 0 40px 0 16px;
  font-size: 20px;
  color: #eee;
  background: #111111;
  border: 2px solid #444;
  border-radius: 10px;
  outline: none;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  @media (hover: hover) {
    &:not(:disabled):hover {
      border-color: #888;
    }
  }
  &:focus {
    border-color: #888;
  }
`;

export const Button = styled.button`
  box-sizing: border-box;
  height: 48px;
  min-width: min(257px, calc((92vw - 72px) / 4));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 20px;
  font-size: 20px;
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

export const GhostButton = styled.button`
  box-sizing: border-box;
  height: 48px;
  min-width: min(257px, calc((92vw - 72px) / 4));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  font-size: 20px;
  color: #bbb;
  background: transparent;
  border: 2px solid #fff;
  border-radius: 10px;
  cursor: pointer;
  white-space: nowrap;
  @media (hover: hover) {
    &:not(:disabled):hover {
      color: #ddd;
    }
  }
  &:not(:disabled):active {
    color: #fff;
  }
  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

// Shared red button for destructive actions (delete, log out, ...).
export const DangerButton = styled(GhostButton)`
  color: #ff3030;
  border-color: #ff3030;
  @media (hover: hover) {
    &:not(:disabled):hover {
      color: #c01c1c;
      border-color: #c01c1c;
    }
  }
  &:not(:disabled):active {
    color: #971515;
    border-color: #971515;
  }
`;

export const Tab = styled.button`
  box-sizing: border-box;
  height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  font-size: 20px;
  color: ${(p) => (p.$active ? "#111" : "#aaa")};
  background: ${(p) => (p.$active ? "#eee" : "transparent")};
  border: 2px solid #fff;
  border-radius: 10px;
  cursor: pointer;
  @media (hover: hover) {
    &:not(:disabled):hover {
      color: ${(p) => (p.$active ? "#111" : "#ccc")};
    }
  }
  &:not(:disabled):active {
    color: ${(p) => (p.$active ? "#111" : "#fff")};
  }
`;

export const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
  width: min(1100px, 92vw);
`;

export const Row = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 24px;
  width: min(1100px, 92vw);
  @media (max-width: 640px) {
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
`;
