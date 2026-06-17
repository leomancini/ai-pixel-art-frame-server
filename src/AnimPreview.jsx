import React, { useEffect, useRef } from "react";
import styled from "styled-components";
import { api } from "./api";

const SIZE = 32;
const DOT_RATIO = 0.32; // dot radius as a fraction of the cell size

// A square wrapper controls the aspect ratio via the padding-top:100% trick
// and an absolutely-positioned canvas fills it. This avoids iOS Safari bugs
// with `aspect-ratio` / percentage-height on the <canvas> (a replaced element),
// which otherwise render it as a tall rectangle.
const Frame = styled.div`
  position: relative;
  width: 100%;
  overflow: hidden;
  background: #000;
  &::before {
    content: "";
    display: block;
    padding-top: 100%;
  }
`;

const Canvas = styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
`;

// Draw one grid of dots from a per-pixel color function (x, y) -> [r,g,b].
function drawGrid(ctx, canvas, colorAt) {
  const cellX = canvas.width / SIZE;
  const cellY = canvas.height / SIZE;
  const r = Math.min(cellX, cellY) * DOT_RATIO;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const [cr, cg, cb] = colorAt(x, y);
      ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
      ctx.beginPath();
      ctx.arc(x * cellX + cellX / 2, y * cellY + cellY / 2, r, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
}

// Plays an animation's frames on a canvas, drawing each pixel as a discrete
// LED with a dark gap between them — like the physical 32×32 matrix. `src` is
// an endpoint returning { frames, delayMs }. The backing store is sized to the
// rendered size × devicePixelRatio so it stays sharp at any width. With
// `shimmer`, it animates a grey/black loading shimmer across the grid instead.
export default function AnimPreview({ src, shimmer, onReady }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  // Live playback state so the resize handler can redraw the current frame
  // immediately (sizing the canvas clears it — otherwise it flickers blank).
  const stateRef = useRef({ frames: null, idx: 0, t: 0 });

  // Draw whatever the current state is to the canvas.
  const draw = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    const st = stateRef.current;
    if (shimmer) {
      drawGrid(ctx, canvas, (x, y) => {
        const v = (Math.sin((x + y) * 0.2 - st.t * 0.12) + 1) / 2;
        const g = Math.round(v * 90);
        return [g, g, g];
      });
    } else if (st.frames) {
      const frame = st.frames[st.idx];
      drawGrid(ctx, canvas, (x, y) => {
        const i = (y * SIZE + x) * 3;
        return [frame[i], frame[i + 1], frame[i + 2]];
      });
    }
  };

  // Keep the backing-store resolution matched to the rendered (square) size,
  // and redraw the current frame right away so resizing never blanks the grid.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      // Hidden (e.g. the frame view while in settings): keep the current backing
      // store so the drawn frame survives — no blank/redraw flash on re-show.
      if (!canvas.clientWidth || !canvas.clientHeight) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        draw();
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shimmer]);

  // Shimmer loading animation: a grey band sweeps diagonally over black pixels.
  useEffect(() => {
    if (!shimmer) return;
    stateRef.current.t = 0;
    const tick = () => {
      stateRef.current.t += 1;
      draw();
      animRef.current = setTimeout(tick, 40);
    };
    tick();
    return () => clearTimeout(animRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shimmer]);

  // Play the animation from `src`.
  useEffect(() => {
    if (shimmer) return;
    let cancelled = false;
    api
      .get(src)
      .then(({ frames, delayMs }) => {
        if (cancelled) return;
        stateRef.current.frames = frames;
        stateRef.current.idx = 0;
        const tick = () => {
          draw();
          stateRef.current.idx = (stateRef.current.idx + 1) % frames.length;
          animRef.current = setTimeout(tick, delayMs);
        };
        tick();
        onReady?.(); // first frame is drawn — safe to fade the card in
      })
      .catch(() => onReady?.()); // don't leave the card hidden on error
    return () => {
      cancelled = true;
      clearTimeout(animRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, shimmer]);

  return (
    <Frame>
      <Canvas ref={canvasRef} />
    </Frame>
  );
}
