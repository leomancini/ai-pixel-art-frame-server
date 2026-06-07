import React, { useEffect, useRef, useState } from "react";
import styled from "styled-components";

const SIZE = 32;

const Page = styled.div`
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 32px;
  background: #0b0b0f;
  color: #eee;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
`;

const Row = styled.div`
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  justify-content: center;
`;

const Card = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: #16161d;
  border: 2px solid ${(p) => (p.$active ? "#5dd6ff" : "#26262f")};
  border-radius: 14px;
  cursor: pointer;
  transition: border-color 0.15s, transform 0.1s;

  &:hover {
    transform: translateY(-2px);
    border-color: ${(p) => (p.$active ? "#5dd6ff" : "#3a3a48")};
  }
`;

const Preview = styled.canvas`
  width: 192px;
  height: 192px;
  image-rendering: pixelated;
  border-radius: 6px;
  background: #000;
`;

const Name = styled.div`
  font-size: 15px;
  color: ${(p) => (p.$active ? "#5dd6ff" : "#ccc")};
`;

// Plays a preset's frames on a 32x32 canvas
function PresetPreview({ presetKey }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/presets/${presetKey}`)
      .then((r) => r.json())
      .then(({ frames, delayMs }) => {
        if (cancelled) return;
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        const image = ctx.createImageData(SIZE, SIZE);
        let idx = 0;
        const tick = () => {
          const frame = frames[idx];
          for (let i = 0; i < SIZE * SIZE; i++) {
            image.data[i * 4] = frame[i * 3];
            image.data[i * 4 + 1] = frame[i * 3 + 1];
            image.data[i * 4 + 2] = frame[i * 3 + 2];
            image.data[i * 4 + 3] = 255;
          }
          ctx.putImageData(image, 0, 0);
          idx = (idx + 1) % frames.length;
          animRef.current = setTimeout(tick, delayMs);
        };
        tick();
      });
    return () => {
      cancelled = true;
      clearTimeout(animRef.current);
    };
  }, [presetKey]);

  return <Preview ref={canvasRef} width={SIZE} height={SIZE} />;
}

function App() {
  const [presets, setPresets] = useState([]);

  useEffect(() => {
    fetch("/api/presets")
      .then((r) => r.json())
      .then(setPresets);
  }, []);

  const activate = async (key) => {
    const res = await fetch(`/api/presets/${key}/activate`, { method: "POST" });
    if (res.ok) {
      setPresets((ps) => ps.map((p) => ({ ...p, active: p.key === key })));
    }
  };

  return (
    <Page>
      <Row>
        {presets.map((p) => (
          <Card key={p.key} $active={p.active} onClick={() => activate(p.key)}>
            <PresetPreview presetKey={p.key} />
            <Name $active={p.active}>{p.name}</Name>
          </Card>
        ))}
      </Row>
    </Page>
  );
}

export default App;
