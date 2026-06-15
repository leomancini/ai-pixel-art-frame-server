import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { api } from "./api";
import { Input, Button, GhostButton, SectionTitle, Muted, Select, DangerButton } from "./ui";

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 56px;
  width: 100%;
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
  box-sizing: border-box;
  min-height: 48px;
  display: flex;
  align-items: center;
  gap: 12px;
`;

const Grow = styled.div`
  flex: 1;
  min-width: 0;
`;

const Sub = styled.div`
  display: inline-block;
  font-size: 20px;
  color: #666;
  word-break: break-all;
`;

// Grey-bordered (like the text fields), darker on hover.
const GreyButton = styled(GhostButton)`
  color: #bbb;
  border-color: #444;
  @media (hover: hover) {
    &:not(:disabled):hover {
      color: #888;
      border-color: #333;
    }
  }
  &:not(:disabled):active {
    color: #666;
    border-color: #2a2a2a;
  }
`;

// A thin "/" separator between a name and its grey sub-labels.
const Sep = styled.span`
  color: #555;
  margin: 0 6px;
`;

const SelectField = styled.div`
  position: relative;
  display: inline-flex;
`;

const SelectArrow = styled.span`
  position: absolute;
  right: 16px;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  pointer-events: none;
  color: #888;
  font-size: 20px;
  text-transform: none;
  transform: translateY(-3px);
`;

const KeyBox = styled.div`
  padding: 12px 0;
  font-size: 20px;
  color: #ccc;
  word-break: break-all;
  -webkit-user-select: text;
  user-select: text;
`;


export default function AdminPanel({ onFramesChanged, onReady }) {
  const [frames, setFrames] = useState([]);
  const [users, setUsers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [frameName, setFrameName] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [newKey, setNewKey] = useState(null); // { slug, name, deviceKey }
  const [err, setErr] = useState("");

  const load = () => {
    Promise.all([api.get("/api/admin/frames"), api.get("/api/admin/users")])
      .then(([fr, us]) => {
        setFrames(fr);
        setUsers(us);
        setLoaded(true);
        onReady?.();
      })
      .catch((e) => setErr(e.message));
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
    setNewKey(await api.post(`/api/admin/frames/${f.id}/key`));
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

  // Each person can access at most one frame. Picking a frame replaces any
  // prior grant (server-side); "None" revokes whatever they had.
  const setAccess = async (u, frameId) => {
    if (frameId == null) {
      for (const fid of u.frameIds) {
        await api.del("/api/admin/access", { userId: u.id, frameId: fid });
      }
    } else {
      await api.post("/api/admin/access", { userId: u.id, frameId });
    }
    load();
  };

  if (!loaded) return null;

  return (
    <Wrap>
      {err && <Muted style={{ color: "#bbb" }}>{err}</Muted>}

      <Section>
        <SectionTitle>Frames</SectionTitle>
        {newKey && (
          <KeyBox>
            Device key for <b>{newKey.name}</b> (slug <code>{newKey.slug}</code>) — flash
            it into that board's <code>secrets.h</code>:
            <br />
            <b>FRAME_SLUG</b> = {newKey.slug}
            <br />
            <b>FRAME_KEY</b> ={" "}
            {newKey.deviceKey ?? "(none stored — rotate to generate one)"}
            <div style={{ marginTop: 8 }}>
              <GhostButton onClick={() => setNewKey(null)}>Done</GhostButton>
            </div>
          </KeyBox>
        )}
        {frames.map((f) => (
          <Item key={f.id}>
            <Grow>
              {f.name}
              <Sep>/</Sep>
              <Sub>{f.slug}</Sub>
            </Grow>
            <GreyButton onClick={() => rotateKey(f)}>Rotate key</GreyButton>
            <DangerButton onClick={() => deleteFrame(f)}>Delete</DangerButton>
          </Item>
        ))}
        <AddForm onSubmit={addFrame}>
          <Input
            value={frameName}
            onChange={(e) => setFrameName(e.target.value)}
            placeholder="name"
            maxLength={60}
          />
          <Button type="submit" disabled={!frameName.trim()}>
            Add
          </Button>
        </AddForm>
      </Section>

      <Section>
        <SectionTitle>People</SectionTitle>
        {users.map((u) => (
          <Item key={u.id}>
            <Grow>
              {u.email}
              <Sep>/</Sep>
              {u.isAdmin && (
                <>
                  <Sub>admin</Sub>
                  <Sep>/</Sep>
                </>
              )}
              <Sub>{u.linked ? "signed in" : "not signed in yet"}</Sub>
            </Grow>
            {!u.isAdmin && (
              <SelectField>
                <Select
                  value={u.frameIds[0] ?? ""}
                  onChange={(e) => {
                    setAccess(u, e.target.value ? Number(e.target.value) : null);
                    e.target.blur();
                  }}
                >
                  <option value="">No frame</option>
                  {frames.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </Select>
                <SelectArrow>v</SelectArrow>
              </SelectField>
            )}
            {!u.isAdmin && (
              <DangerButton onClick={() => deleteUser(u)}>Delete</DangerButton>
            )}
          </Item>
        ))}
        <AddForm onSubmit={addUser}>
          <Input
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
            placeholder="email"
            type="email"
          />
          <Button type="submit" disabled={!userEmail.trim()}>
            Add
          </Button>
        </AddForm>
      </Section>
    </Wrap>
  );
}
