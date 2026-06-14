import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { api } from "./api";
import AnimPreview from "./AnimPreview";
import { Input, Button, Row } from "./ui";

const PromptForm = styled.form`
  display: flex;
  gap: 10px;
  align-items: flex-start;
  width: min(560px, 90vw);
  @media (max-width: 640px) {
    flex-direction: column;
    align-items: stretch;
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
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: ${(p) => (p.$active ? "#1e1e1e" : "transparent")};
  border: none;
  border-radius: 14px;
  cursor: pointer;
  transition: background 0.15s, transform 0.15s ease;
  &:hover {
    transform: scale(1.04);
  }
  &:active {
    transform: scale(0.96);
  }
  @media (max-width: 640px) {
    width: 100%;
  }
`;

const Name = styled.div`
  font-size: 20px;
  color: ${(p) => (p.$active ? "#fff" : "#888")};
  max-width: 160px;
  text-align: center;
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
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setError(false);
    setStatus("Generating… this takes up to a minute");
    try {
      const data = await api.post(`/api/frames/${frame.id}/generate`, {
        prompt: prompt.trim(),
      });
      setPrompt("");
      setStatus(`"${data.name}" is live on ${frame.name}`);
      setTimeout(() => setStatus(""), 4000);
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
    <>
      <PromptForm onSubmit={generate}>
        <Input
          as="textarea"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe an animation… e.g. rain on a city skyline"
          maxLength={500}
          disabled={generating}
          autoComplete="off"
          data-1p-ignore="true"
          data-lpignore="true"
        />
        <Button type="submit" disabled={generating || !prompt.trim()}>
          {generating ? "Generating…" : "Generate"}
        </Button>
      </PromptForm>
      <Status $error={error}>{status}</Status>

      <Row>
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
    </>
  );
}
