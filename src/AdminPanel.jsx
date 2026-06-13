import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { api } from "./api";
import { Input, Button, GhostButton, SectionTitle, Muted } from "./ui";

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 36px;
  width: min(760px, 92vw);
`;

const Section = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const AddForm = styled.form`
  display: flex;
  gap: 10px;
`;

const Item = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: #16161d;
  border: 1px solid #22222b;
  border-radius: 12px;
`;

const Grow = styled.div`
  flex: 1;
  min-width: 0;
`;

const Sub = styled.div`
  font-size: 12px;
  color: #777;
  word-break: break-all;
`;

const KeyBox = styled.div`
  padding: 12px 14px;
  background: #11210f;
  border: 1px solid #2c5026;
  border-radius: 12px;
  font-size: 13px;
  color: #cfe9c9;
  word-break: break-all;
`;

const Checks = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`;

const Check = styled.label`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #ccc;
  cursor: pointer;
`;

export default function AdminPanel({ onFramesChanged }) {
  const [frames, setFrames] = useState([]);
  const [users, setUsers] = useState([]);
  const [frameName, setFrameName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [newKey, setNewKey] = useState(null); // { slug, name, deviceKey }
  const [err, setErr] = useState("");

  const load = () => {
    api.get("/api/admin/frames").then(setFrames).catch((e) => setErr(e.message));
    api.get("/api/admin/users").then(setUsers).catch((e) => setErr(e.message));
  };
  useEffect(load, []);

  const addFrame = async (e) => {
    e.preventDefault();
    if (!frameName.trim()) return;
    setErr("");
    try {
      const f = await api.post("/api/admin/frames", { name: frameName.trim() });
      setNewKey(f);
      setFrameName("");
      load();
      onFramesChanged?.();
    } catch (e) {
      setErr(e.message);
    }
  };

  const rotateKey = async (f) => {
    if (!window.confirm(`Rotate the device key for "${f.name}"? The old key stops working.`)) return;
    const { deviceKey } = await api.post(`/api/admin/frames/${f.id}/key`);
    setNewKey({ slug: f.slug, name: f.name, deviceKey });
  };

  const deleteFrame = async (f) => {
    if (!window.confirm(`Delete "${f.name}" and its gallery? This can't be undone.`)) return;
    await api.del(`/api/admin/frames/${f.id}`);
    load();
    onFramesChanged?.();
  };

  const addUser = async (e) => {
    e.preventDefault();
    if (!userEmail.trim()) return;
    setErr("");
    try {
      await api.post("/api/admin/users", { email: userEmail.trim() });
      setUserEmail("");
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const deleteUser = async (u) => {
    if (!window.confirm(`Remove ${u.email}?`)) return;
    await api.del(`/api/admin/users/${u.id}`);
    load();
  };

  const toggleAccess = async (u, frameId, granted) => {
    if (granted) await api.del("/api/admin/access", { userId: u.id, frameId });
    else await api.post("/api/admin/access", { userId: u.id, frameId });
    load();
  };

  return (
    <Wrap>
      {err && <Muted style={{ color: "#ff6b6b" }}>{err}</Muted>}

      <Section>
        <SectionTitle>Frames</SectionTitle>
        <AddForm onSubmit={addFrame}>
          <Input
            value={frameName}
            onChange={(e) => setFrameName(e.target.value)}
            placeholder="New frame name… e.g. Living Room"
            maxLength={60}
          />
          <Button type="submit" disabled={!frameName.trim()}>
            Add frame
          </Button>
        </AddForm>
        {newKey && (
          <KeyBox>
            Device key for <b>{newKey.name}</b> (slug <code>{newKey.slug}</code>) — shown once,
            flash it into that board's <code>secrets.h</code>:
            <br />
            <b>FRAME_SLUG</b> = {newKey.slug}
            <br />
            <b>FRAME_KEY</b> = {newKey.deviceKey}
            <div style={{ marginTop: 8 }}>
              <GhostButton onClick={() => setNewKey(null)}>Done</GhostButton>
            </div>
          </KeyBox>
        )}
        {frames.map((f) => (
          <Item key={f.id}>
            <Grow>
              {f.name} <Sub>slug: {f.slug}</Sub>
            </Grow>
            <GhostButton onClick={() => rotateKey(f)}>Rotate key</GhostButton>
            <GhostButton onClick={() => deleteFrame(f)}>Delete</GhostButton>
          </Item>
        ))}
        {frames.length === 0 && <Muted>No frames yet — add one above.</Muted>}
      </Section>

      <Section>
        <SectionTitle>People &amp; access</SectionTitle>
        <AddForm onSubmit={addUser}>
          <Input
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
            placeholder="Authorize an email… e.g. friend@gmail.com"
            type="email"
          />
          <Button type="submit" disabled={!userEmail.trim()}>
            Add person
          </Button>
        </AddForm>
        {users.map((u) => (
          <Item key={u.id}>
            <Grow>
              {u.email} {u.isAdmin && <b>(admin)</b>}
              <Sub>{u.linked ? "signed in" : "not signed in yet"}</Sub>
              {!u.isAdmin && (
                <Checks style={{ marginTop: 8 }}>
                  {frames.map((f) => {
                    const granted = u.frameIds.includes(f.id);
                    return (
                      <Check key={f.id}>
                        <input
                          type="checkbox"
                          checked={granted}
                          onChange={() => toggleAccess(u, f.id, granted)}
                        />
                        {f.name}
                      </Check>
                    );
                  })}
                </Checks>
              )}
            </Grow>
            {!u.isAdmin && <GhostButton onClick={() => deleteUser(u)}>Remove</GhostButton>}
          </Item>
        ))}
      </Section>
    </Wrap>
  );
}
