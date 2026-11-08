import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api, HttpError } from "./lib/api";
import { db, getMeta, setMeta } from "./lib/db";
import { dailyPage } from "./lib/store";
import { enableSync, getStatus, startSyncTriggers, subscribeStatus, syncNow } from "./lib/sync";
import { Login, Setup } from "./components/Auth";
import Sidebar from "./components/Sidebar";
import PageView from "./components/PageView";
import Trash from "./components/Trash";

type Phase = { kind: "loading" } | { kind: "login" } | { kind: "setup"; token: string } | { kind: "app"; user: string };

const useHash = () => {
  const [h, setH] = useState(location.hash);
  useEffect(() => {
    const f = () => setH(location.hash);
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return h;
};

let triggersStarted = false;

export default function App() {
  const hash = useHash();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  const [drawer, setDrawer] = useState(false);
  const status = useSyncExternalStore(subscribeStatus, getStatus);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  const go = useCallback((h: string) => {
    location.hash = h;
    setDrawer(false);
  }, []);

  const enter = useCallback(async (email: string) => {
    const prev = await getMeta<string>("user");
    if (prev && prev !== email) {
      // a different person is signing in on this device: never mix their notes with the previous account
      await Promise.all([db.pages.clear(), db.blobs.clear(), db.meta.clear()]);
    }
    await setMeta("user", email);
    enableSync(true);
    if (!triggersStarted) { triggersStarted = true; startSyncTriggers(); }
    setPhase({ kind: "app", user: email });
  }, []);

  // boot: invite link, else cached user (works offline), else ask the server
  useEffect(() => {
    (async () => {
      const m = /^#\/setup\/([0-9a-f]{64})$/.exec(location.hash);
      if (m) return setPhase({ kind: "setup", token: m[1] });
      const cached = await getMeta<string>("user");
      if (cached) {
        await enter(cached);
        return;
      }
      try {
        const me = await api.me();
        await enter(me.email);
      } catch (e) {
        setPhase({ kind: "login" });
        if (!(e instanceof HttpError)) console.info("offline: sign-in needs a connection the first time");
      }
    })();
  }, [enter]);

  // an invite link opened while the app is already running
  useEffect(() => {
    const m = /^#\/setup\/([0-9a-f]{64})$/.exec(hash);
    if (m) setPhase((p) => (p.kind === "setup" && p.token === m[1] ? p : { kind: "setup", token: m[1] }));
  }, [hash]);

  // the server says our session ended
  useEffect(() => {
    if (status.state === "unauth" && phase.kind === "app") { enableSync(false); setPhase({ kind: "login" }); }
  }, [status.state, phase.kind]);

  // default route: today's note
  useEffect(() => {
    if (phase.kind !== "app") return;
    if (!hash || hash === "#/" || hash === "#") {
      void (async () => {
        // On a device that has never synced, fetch first: otherwise it would invent today's note
        // while the server already has one from another device.
        if ((await getMeta<number>("cursor")) === undefined) await syncNow();
        const p = await dailyPage();
        location.replace(`#/page/${p.id}`);
      })();
    }
  }, [phase.kind, hash]);

  const logout = async () => {
    enableSync(false);
    try { await api.logout(); } catch { /* offline: cookie expires on its own */ }
    await db.meta.delete("user");
    setPhase({ kind: "login" });
  };

  if (phase.kind === "loading") return <div className="empty-state">Loading…</div>;
  if (phase.kind === "setup") return <Setup token={phase.token} onDone={() => { location.hash = "#/"; setPhase({ kind: "login" }); }} />;
  if (phase.kind === "login") return <Login onDone={(email) => { void enter(email); }} />;

  const m = /^#\/page\/([\w-]+)$/.exec(hash);
  const current = m ? m[1] : null;

  return (
    <div className={"app" + (drawer ? " drawer-open" : "")}>
      <Sidebar current={current} go={go} user={phase.user} onLogout={logout} theme={theme} toggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")} />
      <div className="scrim" onClick={() => setDrawer(false)} />
      <main className="main">
        <header className="topbar">
          <button aria-label="Open menu" onClick={() => setDrawer(true)}>☰</button>
          <span>Daybook</span>
          {status.state === "offline" && <span className="pill">Offline</span>}
        </header>
        {hash === "#/trash" ? <Trash go={go} /> : current ? <PageView key={current} id={current} go={go} /> : <div className="empty-state">Opening today…</div>}
      </main>
    </div>
  );
}
