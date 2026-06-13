import React, { useEffect, useRef } from "react";
import styled from "styled-components";
import { api } from "./api";

const SIZE = 32;
const LED = 6; // canvas px per LED cell
const DOT_R = 1.8; // radius of each round LED dot

const Canvas = styled.canvas`
  width: 160px;
  height: 160px;
  border-radius: 6px;
  background: #000;
`;

// Plays an animation's frames on a canvas, drawing each pixel as a discrete
// LED with a dark gap between them — like the physical matrix. `src` is an
// endpoint returning { frames, delayMs }.
export default function AnimPreview({ src }) {
  const canvasRef = useRef(null);
  const animRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get(src)
      .then(({ frames, delayMs }) => {
        if (cancelled) return;
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        let idx = 0;
        const tick = () => {
          const frame = frames[idx];
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, SIZE * LED, SIZE * LED);
          for (let y = 0; y < SIZE; y++) {
            for (let x = 0; x < SIZE; x++) {
              const i = (y * SIZE + x) * 3;
              ctx.fillStyle = `rgb(${frame[i]},${frame[i + 1]},${frame[i + 2]})`;
              ctx.beginPath();
              ctx.arc(x * LED + LED / 2, y * LED + LED / 2, DOT_R, 0, 2 * Math.PI);
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

  return <Canvas ref={canvasRef} width={SIZE * LED} height={SIZE * LED} />;
}
