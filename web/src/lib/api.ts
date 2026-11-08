export class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new HttpError(res.status);
  return res.status === 204 ? (undefined as T) : res.json();
}

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });

export const api = {
  me: () => fetch("/api/me", { credentials: "same-origin" }).then((r) => json<{ email: string }>(r)),
  login: (email: string, password: string) => post("/api/login", { email, password }).then((r) => json<{ email: string }>(r)),
  logout: () => post("/api/logout", {}).then((r) => json<void>(r)),
  setup: (token: string, password: string) => post("/api/setup", { token, password }).then((r) => json<void>(r)),
  sync: (body: unknown) => post("/api/sync", body).then((r) => json<{ cursor: number; pages: any[]; more: boolean }>(r)),
  search: (q: string) =>
    fetch(`/api/search?q=${encodeURIComponent(q)}`, { credentials: "same-origin" }).then((r) =>
      json<{ id: string; title: string; snippet: string }[]>(r),
    ),
};
