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
  padding: 32px 24px 64px;
  background: #000;
  color: #eee;
  font-family: var(--pixel-font);
`;

export const Centered = styled.div`
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 40px;
  background: #000;
  color: #eee;
  font-family: var(--pixel-font);
`;

export const Muted = styled.div`
  font-size: 20px;
  color: #888;
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
  color: #aaa;
  margin: 0 0 4px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
`;

export const Input = styled.input`
  flex: 1;
  padding: 12px 16px;
  font-size: 20px;
  color: #eee;
  background: #161616;
  border: 2px solid #555;
  border-radius: 12px;
  outline: none;
  resize: vertical;
  &:focus {
    border-color: #fff;
  }
  &::placeholder {
    color: #666;
  }
`;

export const Select = styled.select`
  padding: 12px 16px;
  font-size: 20px;
  color: #eee;
  background: #161616;
  border: 2px solid #555;
  border-radius: 12px;
  outline: none;
  cursor: pointer;
  &:focus {
    border-color: #fff;
  }
`;

export const Button = styled.button`
  padding: 12px 20px;
  font-size: 20px;
  color: #111;
  background: #eee;
  border: 2px solid #fff;
  border-radius: 12px;
  cursor: pointer;
  white-space: nowrap;
  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

export const GhostButton = styled.button`
  padding: 12px 16px;
  font-size: 20px;
  color: #ccc;
  background: transparent;
  border: 2px solid #fff;
  border-radius: 10px;
  cursor: pointer;
  white-space: nowrap;
  &:hover {
    border-color: #fff;
    color: #fff;
  }
  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

export const Tab = styled.button`
  padding: 8px 16px;
  font-size: 20px;
  color: ${(p) => (p.$active ? "#111" : "#bbb")};
  background: ${(p) => (p.$active ? "#eee" : "transparent")};
  border: 2px solid #fff;
  border-radius: 999px;
  cursor: pointer;
`;

export const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: center;
  width: ${(p) => (p.$wide ? "min(900px, 92vw)" : "min(560px, 92vw)")};
`;

export const Row = styled.div`
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  justify-content: center;
  max-width: 1100px;
  @media (max-width: 640px) {
    width: 92vw;
  }
`;
