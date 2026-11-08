import { useState } from "react";
import { api, HttpError } from "../lib/api";

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="auth">
      <h1>Daybook</h1>
      <h2>{title}</h2>
      {children}
    </main>
  );
}

export function Login({ onDone }: { onDone: (email: string) => void }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await api.login(email, pw);
      onDone(r.email);
    } catch (x) {
      if (x instanceof HttpError && x.status === 401) setErr("Wrong email or password.");
      else if (x instanceof HttpError && x.status === 429) setErr("Too many attempts. Wait 15 minutes and try again.");
      else setErr("Cannot reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title="Sign in">
      <form onSubmit={submit}>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label htmlFor="pw">Password</label>
        <input id="pw" type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <p className="err" role="alert">{err}</p>}
        <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="hint">Daybook is invite-only. Ask the owner for a setup link.</p>
      </form>
    </Shell>
  );
}

export function Setup({ token, onDone }: { token: string; onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 10) return setErr("Use at least 10 characters.");
    if (pw !== pw2) return setErr("The two passwords do not match.");
    try {
      await api.setup(token, pw);
      onDone();
    } catch (x) {
      setErr(x instanceof HttpError && x.status === 404 ? "This link was already used or is not valid. Ask for a new one." : "Cannot reach the server.");
    }
  };

  return (
    <Shell title="Choose your password">
      <form onSubmit={submit}>
        <label htmlFor="npw">New password (10+ characters)</label>
        <input id="npw" type="password" autoComplete="new-password" required value={pw} onChange={(e) => setPw(e.target.value)} />
        <label htmlFor="npw2">Repeat password</label>
        <input id="npw2" type="password" autoComplete="new-password" required value={pw2} onChange={(e) => setPw2(e.target.value)} />
        {err && <p className="err" role="alert">{err}</p>}
        <button>Save password</button>
      </form>
    </Shell>
  );
}
