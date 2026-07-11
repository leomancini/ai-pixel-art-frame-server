import React, { useEffect, useRef, useState } from "react";
import styled, { keyframes, css } from "styled-components";
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
  gap: 24px;
  align-items: stretch;
  width: min(1100px, 92vw);
  @media (max-width: 640px) {
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
    width: 92vw;
    & > textarea {
      height: auto;
      min-height: 0;
      line-height: 1.3;
    }
  }
`;


const Status = styled.div`
  font-size: 20px;
  color: ${(p) => (p.$error ? "#bbb" : "#777")};
  min-height: 1.2em;
  text-align: center;
`;

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
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
  gap: 16px;
  /* Padding shrinks the preview grid inside the card so the LED dots read a bit
     smaller. Mobile gets a modest bump; desktop more. gap is the space between
     the grid and the title. Dots scale with the preview, so smaller = smaller. */
  padding: 24px 24px 22px;
  @media (min-width: 641px) {
    padding: 28px 28px 22px;
    gap: 18px;
  }
  background: #000;
  border: none;
  box-shadow: inset 0 0 0 2px ${(p) => (p.$active ? "#fff" : "#444")};
  border-radius: 10px;
  cursor: pointer;
  color: inherit;
  font: inherit;
  /* Inner content shouldn't swallow taps; the button handles them. */
  & > * {
    pointer-events: none;
  }
  /* No press state — the selection border (instant, optimistic) is the
     feedback. Avoids any active-on-scroll/flicker on touch. */
  @media (hover: hover) {
    &:hover {
      box-shadow: inset 0 0 0 2px ${(p) => (p.$active ? "#fff" : "#888")};
    }
  }
  /* A freshly generated card stays hidden until its canvas has drawn, then the
     whole card (border, title, canvas) fades in together. */
  ${(p) =>
    p.$fresh &&
    (p.$show
      ? css`
          animation: ${fadeIn} 0.4s ease;
        `
      : css`
          opacity: 0;
        `)}
`;

const pulse = keyframes`
  0%, 100% { opacity: 0.2; }
  50% { opacity: 0.5; }
`;

// Wrapper grid cell that fades the loading card out. Fading a wrapper (rather
// than the card itself) avoids an opacity flicker — removing the pulse
// animation would otherwise snap opacity back to 1 for a frame.
const PendingCell = styled.div`
  min-width: 0;
  transition: opacity 0.35s ease;
  opacity: ${(p) => (p.$out ? 0 : 1)};
`;

const Name = styled.div`
  width: 100%;
  font-size: 20px;
  color: ${(p) => (p.$active ? "#fff" : "#777")};
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  @media (hover: hover) {
    ${Card}:hover & {
      color: ${(p) => (p.$active ? "#fff" : "#aaa")};
    }
  }
`;

// Defined after Name so its hover overrides win the cascade: the loading tile
// isn't interactive, so it keeps the resting border/title colors on hover.
const LoadingCard = styled(Card)`
  animation: ${pulse} 1.4s ease-in-out infinite;
  cursor: wait;
  @media (hover: hover) {
    &:hover {
      box-shadow: inset 0 0 0 2px #444;
    }
    &:hover ${Name} {
      color: #777;
    }
  }
`;

// Gallery card: tap selects; long-press confirms deletion. No press visual —
// the selection border is the feedback. Movement cancels the long-press.
function GalleryCard({ src, name, active, fresh, onSelect, onDelete }) {
  const timer = useRef(null);
  const longRef = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  // Fresh cards stay hidden until the canvas reports its first draw, so the whole
  // card fades in at once instead of the border/title fading before the canvas.
  const [ready, setReady] = useState(false);

  const down = (e) => {
    longRef.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    timer.current = setTimeout(() => {
      longRef.current = true;
      onDelete();
    }, 550);
  };
  const move = (e) => {
    if (
      Math.abs(e.clientX - start.current.x) > 10 ||
      Math.abs(e.clientY - start.current.y) > 10
    ) {
      clearTimeout(timer.current);
    }
  };
  const end = () => clearTimeout(timer.current);
  const click = () => {
    if (longRef.current) {
      longRef.current = false;
      return; // long-press handled the delete; don't also select
    }
    onSelect();
  };

  return (
    <Card
      type="button"
      $active={active}
      $fresh={fresh}
      $show={ready}
      onClick={click}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={end}
      onPointerLeave={end}
      onContextMenu={(e) => e.preventDefault()}
    >
      <AnimPreview src={src} onReady={() => setReady(true)} />
      <Name $active={active}>{name}</Name>
    </Card>
  );
}

// Tracks the mobile breakpoint so the prompt can be a multi-line textarea on
// mobile and a single-line input on desktop.
function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width: 640px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const onChange = (e) => setMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return mobile;
}

// Generate + gallery + preset picker for a single frame. `frame` carries the
// active selection; `refresh` reloads the frame list so highlights stay live.
export default function FrameControl({ frame, refresh }) {
  const isMobile = useIsMobile();
  const [gallery, setGallery] = useState([]);
  const [presets, setPresets] = useState([]);
  const [prompt, setPrompt] = useState("");
  // "idle" | "loading" (generating) | "out" (loading card fading out)
  const [phase, setPhase] = useState("idle");
  const [freshId, setFreshId] = useState(null); // newly generated card (fades in)
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const [verb, setVerb] = useState(LOADING_VERBS[0]);
  const busy = phase !== "idle";

  // Cycle through random verbs while generating.
  useEffect(() => {
    if (phase !== "loading") return;
    const pick = () =>
      setVerb(LOADING_VERBS[Math.floor(Math.random() * LOADING_VERBS.length)]);
    pick();
    const id = setInterval(pick, 1500);
    return () => clearInterval(id);
  }, [phase]);

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
    if (!text || busy) return;

    // `say hello world` / `say "hello world"` — scroll the text as a marquee
    // on the frame, no AI generation involved.
    const say = text.match(/^say\s+([\s\S]+)$/i);
    if (say) {
      setPhase("loading");
      setError(false);
      setStatus("");
      setPrompt("");
      try {
        const data = await api.post(`/api/frames/${frame.id}/say`, { text: say[1] });
        refresh(); // the frame's active selection is now the message
        setStatus(`Now showing “${data.text}”`);
      } catch (err) {
        setError(true);
        setStatus(err.message);
      }
      setPhase("idle");
      return;
    }

    setPhase("loading");
    setError(false);
    setStatus("");
    setPrompt(""); // clear + disable the field immediately
    // Hold the front cell with a pending placeholder so the grid never reflows.
    setGallery((g) => [{ pending: true }, ...g]);
    try {
      const data = await api.post(`/api/frames/${frame.id}/generate`, {
        prompt: text,
      });
      refresh(); // server activated the new animation (updates selection)
      setPhase("out"); // fade the placeholder out (in place — no reflow)
      setTimeout(() => {
        // Swap the placeholder for the real card in the SAME cell; it fades in.
        setFreshId(data.id);
        setGallery((g) =>
          g.map((it) =>
            it.pending ? { id: data.id, name: data.name, prompt: text } : it
          )
        );
        setPhase("idle");
        setTimeout(() => setFreshId(null), 600);
        loadLists(); // re-sync with the server
      }, 350);
    } catch (err) {
      setGallery((g) => g.filter((it) => !it.pending));
      setPhase("idle");
      setError(true);
      setStatus(err.message);
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
          {...(isMobile ? { as: "textarea", rows: 3 } : {})}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe an animation"
          maxLength={500}
          disabled={busy}
          autoCorrect="on"
          autoCapitalize="sentences"
          spellCheck={true}
          data-1p-ignore="true"
          data-lpignore="true"
        />
        <Button type="submit" disabled={busy || !prompt.trim()}>
          Create
        </Button>
      </PromptForm>
      {status && <Status $error={error}>{status}</Status>}

      <Row>
        {gallery.map((g) =>
          g.pending ? (
            <PendingCell key="pending" $out={phase === "out"}>
              <LoadingCard as="div">
                <AnimPreview shimmer />
                <Name>{verb}</Name>
              </LoadingCard>
            </PendingCell>
          ) : (
            <GalleryCard
              key={`g-${g.id}`}
              src={`/api/frames/${frame.id}/gallery/${g.id}`}
              name={g.name}
              active={isActiveGallery(g.id)}
              fresh={g.id === freshId}
              onSelect={() => activateGallery(g.id)}
              onDelete={() => remove(g.id, g.name)}
            />
          )
        )}
        {presets.map((p) => (
          <Card
            type="button"
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
