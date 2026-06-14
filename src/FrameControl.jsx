import React, { useEffect, useRef, useState } from "react";
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
  align-items: stretch;
  width: min(1100px, 92vw);
  /* Desktop: single-line textarea (button height), fills width, button right. */
  & > textarea {
    box-sizing: border-box;
    height: 48px;
    min-height: 48px;
  }
  @media (max-width: 640px) {
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
    width: 92vw;
    & > textarea {
      height: auto;
      min-height: 0;
    }
  }
`;

const Status = styled.div`
  font-size: 20px;
  color: ${(p) => (p.$error ? "#bbb" : "#777")};
  min-height: 1.2em;
  text-align: center;
`;

// A native <button> so iOS reliably fires click (tap-to-select).
const Card = styled.button`
  position: relative;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-width: 0;
  width: 100%;
  gap: 12px;
  padding: 12px 12px 18px;
  background: #000;
  border: none;
  box-shadow: inset 0 0 0 2px
    ${(p) => (p.$active || p.$pressed ? "#fff" : "#444")};
  border-radius: 14px;
  cursor: pointer;
  color: inherit;
  font: inherit;
  /* Inner content shouldn't swallow taps; the button handles them. */
  & > * {
    pointer-events: none;
  }
  /* Press feedback comes from $pressed (pointer events, cancelled on scroll)
     instead of :active, so scrolling on iOS doesn't light up cards. */
  @media (hover: hover) {
    &:hover {
      box-shadow: inset 0 0 0 2px
        ${(p) => (p.$active || p.$pressed ? "#fff" : "#888")};
    }
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
  color: ${(p) => (p.$active ? "#fff" : p.$pressed ? "#ccc" : "#777")};
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  @media (hover: hover) {
    ${Card}:hover & {
      color: ${(p) => (p.$active ? "#fff" : p.$pressed ? "#ccc" : "#aaa")};
    }
  }
`;

// Selectable card: tap selects; press feedback is cancelled on scroll so it
// doesn't light up while scrolling on iOS. If `onDelete` is given, a long-press
// confirms deletion.
function SelectableCard({ src, name, active, onSelect, onDelete }) {
  const [pressed, setPressed] = useState(false);
  const timer = useRef(null);
  const longRef = useRef(false);
  const moved = useRef(false);
  const start = useRef({ x: 0, y: 0 });

  const down = (e) => {
    longRef.current = false;
    moved.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    setPressed(true);
    if (onDelete) {
      timer.current = setTimeout(() => {
        longRef.current = true;
        setPressed(false);
        onDelete();
      }, 550);
    }
  };
  const move = (e) => {
    if (
      Math.abs(e.clientX - start.current.x) > 10 ||
      Math.abs(e.clientY - start.current.y) > 10
    ) {
      moved.current = true;
      setPressed(false);
      clearTimeout(timer.current);
    }
  };
  const end = () => {
    setPressed(false);
    clearTimeout(timer.current);
  };
  const click = () => {
    if (longRef.current) {
      longRef.current = false;
      return; // long-press handled the delete; don't also select
    }
    if (moved.current) return; // it was a scroll, not a tap
    onSelect();
  };

  return (
    <Card
      type="button"
      $active={active}
      $pressed={pressed}
      onClick={click}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={end}
      onPointerLeave={end}
      onPointerCancel={end}
      onContextMenu={(e) => e.preventDefault()}
    >
      <AnimPreview src={src} />
      <Name $active={active} $pressed={pressed}>
        {name}
      </Name>
    </Card>
  );
}

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
    const id = setInterval(pick, 1500);
    return () => clearInterval(id);
  }, [generating]);

  const loadLists = () => {
    api.get(`/api/frames/${frame.id}/gallery`).then(setGallery).catch(() => {});
    api.get("/api/presets").then(setPresets).catch(() => {});
  };
  useEffect(loadLists, [frame.id]);

  // Optimistic selection so the active border doesn't flicker while the
  // activate request round-trips; cleared once the server's state catches up.
  const [optimistic, setOptimistic] = useState(null);
  useEffect(() => {
    setOptimistic(null);
  }, [frame.active?.kind, frame.active?.presetKey, frame.active?.galleryId]);

  const active = optimistic || frame.active || {};
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
    setOptimistic({ kind: "preset", presetKey: key });
    await api.post(`/api/frames/${frame.id}/presets/${key}/activate`);
    refresh();
  };

  const activateGallery = async (id) => {
    setOptimistic({ kind: "gallery", galleryId: id });
    await api.post(`/api/frames/${frame.id}/gallery/${id}/activate`);
    refresh();
  };

  const remove = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete ${name.toUpperCase()}?`)) return;
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
          <LoadingCard as="div">
            <AnimPreview shimmer />
            <Name>{verb}</Name>
          </LoadingCard>
        )}
        {gallery.map((g) => (
          <SelectableCard
            key={`g-${g.id}`}
            src={`/api/frames/${frame.id}/gallery/${g.id}`}
            name={g.name}
            active={isActiveGallery(g.id)}
            onSelect={() => activateGallery(g.id)}
            onDelete={() => remove(g.id, g.name)}
          />
        ))}
        {presets.map((p) => (
          <SelectableCard
            key={`p-${p.key}`}
            src={`/api/presets/${p.key}`}
            name={p.name}
            active={isActivePreset(p.key)}
            onSelect={() => activatePreset(p.key)}
          />
        ))}
      </Row>
    </Content>
  );
}
