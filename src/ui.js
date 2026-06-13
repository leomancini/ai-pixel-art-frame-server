// Shared styled-components for the dark pixel-frame aesthetic.
import styled from "styled-components";

export const Page = styled.div`
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
  padding: 32px 24px 64px;
  background: #0b0b0f;
  color: #eee;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
`;

export const Centered = styled.div`
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  background: #0b0b0f;
  color: #eee;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
`;

export const Muted = styled.div`
  font-size: 14px;
  color: #888;
  text-align: center;
`;

export const Title = styled.h1`
  font-size: 22px;
  font-weight: 600;
  margin: 0;
`;

export const SectionTitle = styled.h2`
  font-size: 15px;
  font-weight: 600;
  color: #aaa;
  margin: 0 0 4px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
`;

export const Input = styled.input`
  flex: 1;
  padding: 12px 16px;
  font-size: 15px;
  color: #eee;
  background: #16161d;
  border: 2px solid #26262f;
  border-radius: 12px;
  outline: none;
  &:focus {
    border-color: #3a3a48;
  }
  &::placeholder {
    color: #666;
  }
`;

export const Button = styled.button`
  padding: 12px 20px;
  font-size: 15px;
  color: #0b0b0f;
  background: #eee;
  border: none;
  border-radius: 12px;
  cursor: pointer;
  white-space: nowrap;
  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

export const GhostButton = styled.button`
  padding: 8px 14px;
  font-size: 13px;
  color: #ccc;
  background: transparent;
  border: 1px solid #2a2a34;
  border-radius: 10px;
  cursor: pointer;
  white-space: nowrap;
  &:hover {
    border-color: #44444f;
    color: #fff;
  }
  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

export const Tab = styled.button`
  padding: 8px 16px;
  font-size: 14px;
  color: ${(p) => (p.$active ? "#0b0b0f" : "#bbb")};
  background: ${(p) => (p.$active ? "#eee" : "transparent")};
  border: 1px solid ${(p) => (p.$active ? "#eee" : "#2a2a34")};
  border-radius: 999px;
  cursor: pointer;
`;

export const Row = styled.div`
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  justify-content: center;
  max-width: 1100px;
`;
