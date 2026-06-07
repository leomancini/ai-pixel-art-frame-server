import React, { useEffect, useRef, useState } from "react";
import styled from "styled-components";

const SIZE = 32;

const Page = styled.div`
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 40px;
  padding: 48px 24px;
  background: #0b0b0f;
  color: #eee;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
`;

const PromptForm = styled.form`
  display: flex;
  gap: 10px;
  width: min(560px, 90vw);
`;

const PromptInput = styled.input`
  flex: 1;
  padding: 14px 18px;
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

const GenerateButton = styled.button`
  padding: 14px 22px;
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

const GenerationStatus = styled.div`
  font-size: 14px;
  color: ${(p) => (p.$error ? "#fff" : "#888")};
  min-height: 1.2em;
  text-align: center;
`;

const Row = styled.div`
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  justify-content: center;
  max-width: 1100px;
`;

const Card = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: ${(p) => (p.$active ? "#1e1e26" : "transparent")};
  border: none;
  border-radius: 14px;
  cursor: pointer;
  transition: transform 0.1s, background 0.15s;

  &:hover {
    transform: translateY(-2px);
  }
`;

const Preview = styled.canvas`
  width: 160px;
  height: 160px;
  image-rendering: pixelated;
  border-radius: 6px;
  background: #000;
`;

const Name = styled.div`
  font-size: 15px;
  color: ${(p) => (p.$active ? "#fff" : "#888")};
  max-width: 160px;
`;

// Plays an animation's frames on a 32x32 canvas, fetched from `src`
function AnimPreview({ src }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetch(src)
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
  }, [src]);

  return <Preview ref={canvasRef} width={SIZE} height={SIZE} />;
}

function App() {
  const [presets, setPresets] = useState([]);
  const [gallery, setGallery] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState("");
  const [genError, setGenError] = useState(false);

  const refresh = () => {
    fetch("/api/presets").then((r) => r.json()).then(setPresets);
    fetch("/api/gallery").then((r) => r.json()).then(setGallery);
  };
  useEffect(refresh, []);

  const generate = async (e) => {
    e.preventDefault();
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setGenError(false);
    setGenStatus("Generating… this takes up to a minute");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "generation failed");
      setPrompt("");
      setGenStatus(`"${data.name}" is live on the frame`);
      setTimeout(() => setGenStatus(""), 4000);
      refresh();
    } catch (err) {
      setGenError(true);
      setGenStatus(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const activatePreset = async (key) => {
    const res = await fetch(`/api/presets/${key}/activate`, { method: "POST" });
    if (res.ok) refresh();
  };

  const activateGallery = async (id) => {
    const res = await fetch(`/api/gallery/${id}/activate`, { method: "POST" });
    if (res.ok) refresh();
  };

  return (
    <Page>
      <PromptForm onSubmit={generate}>
        <PromptInput
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe an animation… e.g. rain falling on a city skyline"
          maxLength={500}
          disabled={generating}
        />
        <GenerateButton type="submit" disabled={generating || !prompt.trim()}>
          {generating ? "Generating…" : "Generate"}
        </GenerateButton>
      </PromptForm>
      <GenerationStatus $error={genError}>{genStatus}</GenerationStatus>

      <Row>
        {gallery.map((g) => (
          <Card
            key={`g-${g.id}`}
            $active={g.active}
            title={g.prompt}
            onClick={() => activateGallery(g.id)}
          >
            <AnimPreview src={`/api/gallery/${g.id}`} />
            <Name $active={g.active}>{g.name}</Name>
          </Card>
        ))}
        {presets.map((p) => (
          <Card
            key={`p-${p.key}`}
            $active={p.active}
            onClick={() => activatePreset(p.key)}
          >
            <AnimPreview src={`/api/presets/${p.key}`} />
            <Name $active={p.active}>{p.name}</Name>
          </Card>
        ))}
      </Row>
    </Page>
  );
}

export default App;
