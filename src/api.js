// Thin fetch wrapper: same-origin cookies, JSON in/out, central 401 handling
// (a 401 anywhere drops the SPA back to the login gate).

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

// Public link mode: the key from /f/<slug>?key=… is sent on every request as
// X-Public-Key instead of a session cookie. Set once by the public page.
let publicKey = null;
export function setPublicKey(key) {
  publicKey = key || null;
}

async function req(method, path, body) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (publicKey) headers["X-Public-Key"] = publicKey;
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    onUnauthorized();
    throw new Error("unauthorized");
  }
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) throw new Error((data && data.error) || `request failed (${res.status})`);
  return data;
}

export const api = {
  get: (p) => req("GET", p),
  post: (p, b) => req("POST", p, b),
  patch: (p, b) => req("PATCH", p, b),
  del: (p, b) => req("DELETE", p, b),
};
