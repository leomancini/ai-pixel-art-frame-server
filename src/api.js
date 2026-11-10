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

// `timeoutMs` (optional) aborts a request that hangs, so callers that show a
// loading state get an error instead of waiting forever.
async function req(method, path, body, timeoutMs) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (publicKey) headers["X-Public-Key"] = publicKey;
  let res, text;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers,
      body: body ? JSON.stringify(body) : undefined,
      // Older browsers lack AbortSignal.timeout — they just get no timeout.
      signal: timeoutMs && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
    });
    if (res.status !== 401) text = await res.text();
  } catch (err) {
    if (err?.name === "TimeoutError") throw new Error("request timed out — please try again");
    throw err;
  }
  if (res.status === 401) {
    onUnauthorized();
    throw new Error("unauthorized");
  }
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
  get: (p, t) => req("GET", p, undefined, t),
  post: (p, b, t) => req("POST", p, b, t),
  patch: (p, b) => req("PATCH", p, b),
  del: (p, b) => req("DELETE", p, b),
};
