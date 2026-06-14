import React, { useEffect, useState } from "react";
import styled, { keyframes } from "styled-components";
import { api } from "./api";
import AnimPreview from "./AnimPreview";
import { Input, Button, Row } from "./ui";

// Verbs cycled through as the loading-card title while an animation generates.
const LOADING_VERBS = [
  "Painting", "Dreaming", "Conjuring", "Rendering", "Imagining", "Sketching",
  "Pixelating", "Glowing", "Shimmering", "Weaving", "Summoning", "Brewing",
  "Forging", "Sculpting", "Animating", "Crafting", "Generating", "Blooming",
  "Swirling", "Drifting", "Pulsing", "Flickering", "Dancing", "Twinkling",
  "Spinning", "Morphing", "Blending", "Composing", "Designing", "Coloring",
  "Illuminating", "Materializing", "Manifesting", "Doodling", "Drawing",
  "Inventing", "Creating", "Building", "Assembling", "Wandering", "Floating",
  "Cascading", "Rippling", "Radiating", "Beaming", "Sparkling", "Drizzling",
  "Scattering", "Gathering", "Forming", "Shaping", "Molding", "Etching",
  "Tracing", "Plotting", "Mapping", "Charting", "Scripting", "Calculating",
  "Computing", "Processing", "Synthesizing", "Fabricating", "Producing",
  "Hatching", "Growing", "Blossoming", "Flourishing", "Unfolding", "Emerging",
  "Awakening", "Igniting", "Kindling", "Sparking", "Charging", "Energizing",
  "Vibrating", "Oscillating", "Resonating", "Humming", "Buzzing", "Whirring",
  "Spiraling", "Orbiting", "Looping", "Cycling", "Rotating", "Tumbling",
  "Bouncing", "Gliding", "Soaring", "Diving", "Surging", "Flowing",
  "Streaming", "Pouring", "Polishing", "Refining", "Tinkering", "Cooking",
];

const Content = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 40px;
`;

const PromptForm = styled.form`
  display: flex;
  gap: 10px;
  align-items: flex-start;
  width: min(560px, 90vw);
  @media (max-width: 640px) {
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
    width: 92vw;
  }
`;

const Status = styled.div`
  font-size: 20px;
  color: ${(p) => (p.$error ? "#ccc" : "#888")};
  min-height: 1.2em;
  text-align: center;
`;

const Card = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-width: 0;
  gap: 12px;
  padding: 12px 12px 18px;
  background: #000;
  border: none;
  box-shadow: inset 0 0 0 2px ${(p) => (p.$active ? "#fff" : "#555")};
  border-radius: 14px;
  cursor: pointer;
  transition: background 0.15s, transform 0.15s ease;
  @media (hover: hover) {
    &:hover {
      transform: scale(1.04);
    }
  }
  &:active {
    transform: scale(0.96);
  }
`;

const pulse = keyframes`
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
`;

const LoadingCard = styled(Card)`
  animation: ${pulse} 1.4s ease-in-out infinite;
`;

const Name = styled.div`
  width: 100%;
  font-size: 20px;
  color: ${(p) => (p.$active ? "#fff" : "#888")};
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const DeleteX = styled.button`
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  ${Card}:hover & {
    opacity: 1;
  }
  &:hover {
    background: #555;
  }
`;

// Generate + gallery + preset picker for a single frame. `frame` carries the
// active selection; `refresh` reloads the frame list so highlights stay live.
export default function FrameControl({ frame, refresh }) {
  const [gallery, setGallery] = useState([]);
  const [presets, setPresets] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const [verb, setVerb] = useState(LOADING_VERBS[0]);

  // Cycle through random verbs while generating.
  useEffect(() => {
    if (!generating) return;
    const pick = () =>
      setVerb(LOADING_VERBS[Math.floor(Math.random() * LOADING_VERBS.length)]);
    pick();
    const id = setInterval(pick, 3000);
    return () => clearInterval(id);
  }, [generating]);

  const loadLists = () => {
    api.get(`/api/frames/${frame.id}/gallery`).then(setGallery).catch(() => {});
    api.get("/api/presets").then(setPresets).catch(() => {});
  };
  useEffect(loadLists, [frame.id]);

  const active = frame.active || {};
  const isActivePreset = (key) => active.kind === "preset" && active.presetKey === key;
  const isActiveGallery = (id) => active.kind === "gallery" && active.galleryId === id;

  const generate = async (e) => {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || generating) return;
    setGenerating(true);
    setError(false);
    setStatus("");
    setPrompt(""); // clear + disable the textarea immediately
    try {
      await api.post(`/api/frames/${frame.id}/generate`, { prompt: text });
      // Server activates the new animation; reload so it shows as selected.
      loadLists();
      refresh();
    } catch (err) {
      setError(true);
      setStatus(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const activatePreset = async (key) => {
    await api.post(`/api/frames/${frame.id}/presets/${key}/activate`);
    refresh();
  };

  const activateGallery = async (id) => {
    await api.post(`/api/frames/${frame.id}/gallery/${id}/activate`);
    refresh();
  };

  const remove = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm("Delete this animation?")) return;
    await api.del(`/api/frames/${frame.id}/gallery/${id}`);
    loadLists();
    refresh();
  };

  return (
    <Content>
      <PromptForm onSubmit={generate}>
        <Input
          as="textarea"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe an animation"
          maxLength={500}
          disabled={generating}
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
        />
        <Button type="submit" disabled={generating || !prompt.trim()}>
          Create
        </Button>
      </PromptForm>
      {status && <Status $error={error}>{status}</Status>}

      <Row>
        {generating && (
          <LoadingCard>
            <AnimPreview shimmer />
            <Name>{verb}</Name>
          </LoadingCard>
        )}
        {gallery.map((g) => (
          <Card
            key={`g-${g.id}`}
            $active={isActiveGallery(g.id)}
            title={g.prompt}
            onClick={() => activateGallery(g.id)}
          >
            <DeleteX title="Delete" onClick={(e) => remove(g.id, e)}>
              ×
            </DeleteX>
            <AnimPreview src={`/api/frames/${frame.id}/gallery/${g.id}`} />
            <Name $active={isActiveGallery(g.id)}>{g.name}</Name>
          </Card>
        ))}
        {presets.map((p) => (
          <Card
            key={`p-${p.key}`}
            $active={isActivePreset(p.key)}
            onClick={() => activatePreset(p.key)}
          >
            <AnimPreview src={`/api/presets/${p.key}`} />
            <Name $active={isActivePreset(p.key)}>{p.name}</Name>
          </Card>
        ))}
      </Row>
    </Content>
  );
}
