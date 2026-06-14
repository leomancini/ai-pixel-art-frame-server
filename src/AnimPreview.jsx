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
  width: 160px;
  overflow: hidden;
  background: #000;
  &::before {
    content: "";
    display: block;
    padding-top: 100%;
  }
  @media (max-width: 640px) {
    width: 100%;
  }
`;

const Canvas = styled.canvas`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
`;

// Plays an animation's frames on a canvas, drawing each pixel as a discrete
// LED with a dark gap between them — like the physical 32×32 matrix. `src` is
// an endpoint returning { frames, delayMs }. The backing store is sized to the
// rendered size × devicePixelRatio so it stays sharp at any width.
export default function AnimPreview({ src }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  // Keep the backing-store resolution matched to the rendered (square) size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round((canvas.clientWidth || 160) * dpr));
      const h = Math.max(1, Math.round((canvas.clientHeight || 160) * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get(src)
      .then(({ frames, delayMs }) => {
        if (cancelled) return;
        let idx = 0;
        const tick = () => {
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (!ctx) return;
          const cellX = canvas.width / SIZE;
          const cellY = canvas.height / SIZE;
          const r = Math.min(cellX, cellY) * DOT_RATIO;
          const frame = frames[idx];
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          for (let y = 0; y < SIZE; y++) {
            for (let x = 0; x < SIZE; x++) {
              const i = (y * SIZE + x) * 3;
              ctx.fillStyle = `rgb(${frame[i]},${frame[i + 1]},${frame[i + 2]})`;
              ctx.beginPath();
              ctx.arc(x * cellX + cellX / 2, y * cellY + cellY / 2, r, 0, 2 * Math.PI);
              ctx.fill();
            }
          }
          idx = (idx + 1) % frames.length;
          animRef.current = setTimeout(tick, delayMs);
        };
        tick();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(animRef.current);
    };
  }, [src]);

  return (
    <Frame>
      <Canvas ref={canvasRef} />
    </Frame>
  );
}
