import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { createPage, dailyPage, movePage, trashPage } from "../lib/store";
import { getStatus, subscribeStatus, syncNow } from "../lib/sync";
import { docText } from "../lib/text";
import { exportJSON, importJSON } from "../lib/exportImport";
import type { Page } from "../lib/types";

interface Props {
  current: string | null;
  go: (hash: string) => void;
  user: string;
  onLogout: () => void;
  theme: string;
  toggleTheme: () => void;
}

const loadOpen = (): Record<string, boolean> => {
  try { return JSON.parse(localStorage.getItem("open") ?? "{}"); } catch { return {}; }
};

function statusText(s: ReturnType<typeof getStatus>): string {
  switch (s.state) {
    case "syncing": return "Syncing…";
    case "offline": return "Offline. Saved on this device";
    case "error": return "Sync problem. Retrying";
    case "unauth": return "Signed out. Sign in to sync";
    default: return s.last ? `Synced ${new Date(s.last).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Ready";
  }
}

export default function Sidebar({ current, go, user, onLogout, theme, toggleTheme }: Props) {
  const pages = useLiveQuery(() => db.pages.filter((p) => !p.deleted_at).toArray(), [], [] as Page[]);
  const trashCount = useLiveQuery(() => db.pages.filter((p) => !!p.deleted_at).count(), [], 0);
  const status = useSyncExternalStore(subscribeStatus, getStatus);
  const [open, setOpen] = useState(loadOpen);
  const [q, setQ] = useState("");
  const [drop, setDrop] = useState<{ id: string; where: "before" | "after" | "inside" } | null>(null);
  const dragId = useRef<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const toggle = (id: string) => {
    const next = { ...open, [id]: !open[id] };
    setOpen(next);
    localStorage.setItem("open", JSON.stringify(next));
  };

  const { byParent, daily } = useMemo(() => {
    const byParent = new Map<string | null, Page[]>();
    const daily: Page[] = [];
    for (const p of pages) {
      if (p.daily_date) { daily.push(p); continue; }
      const k = p.parent_id;
      byParent.set(k, [...(byParent.get(k) ?? []), p]);
    }
    byParent.forEach((v) => v.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0)));
    daily.sort((a, b) => (a.daily_date! < b.daily_date! ? 1 : -1));
    return { byParent, daily };
  }, [pages]);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return null;
    return pages
      .filter((p) => p.title.toLowerCase().includes(t) || (p.content && docText(p.content).toLowerCase().includes(t)))
      .slice(0, 30);
  }, [q, pages]);

  const row = (p: Page, depth: number) => {
    const kids = byParent.get(p.id) ?? [];
    const isOpen = !!open[p.id];
    const cls = ["node", p.id === current ? "active" : "", drop?.id === p.id ? `drop-${drop.where}` : ""].join(" ");
    return (
      <div key={p.id}>
        <div
          className={cls}
          style={{ paddingLeft: 6 + depth * 14 }}
          draggable
          onDragStart={(e) => { dragId.current = p.id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p.id); }}
          onDragEnd={() => { dragId.current = null; setDrop(null); }}
          onDragOver={(e) => {
            if (!dragId.current || dragId.current === p.id) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const f = (e.clientY - r.top) / r.height;
            setDrop({ id: p.id, where: f < 0.28 ? "before" : f > 0.72 ? "after" : "inside" });
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId.current && drop) {
              void movePage(dragId.current, drop.id, drop.where);
              if (drop.where === "inside") { const n = { ...open, [drop.id]: true }; setOpen(n); localStorage.setItem("open", JSON.stringify(n)); }
            }
            dragId.current = null;
            setDrop(null);
          }}
          onClick={() => go(`#/page/${p.id}`)}
        >
          <button className="caret" aria-label={isOpen ? "Collapse" : "Expand"} onClick={(e) => { e.stopPropagation(); toggle(p.id); }} style={{ visibility: kids.length ? "visible" : "hidden" }}>
            {isOpen ? "▾" : "▸"}
          </button>
          <span className="name">{p.kind === "database" ? "▦ " : ""}{p.title || "Untitled"}</span>
          <button className="act" title="Add subpage" aria-label="Add subpage" onClick={async (e) => { e.stopPropagation(); const c = await createPage({ parent_id: p.id }); setOpen({ ...open, [p.id]: true }); go(`#/page/${c.id}`); }}>＋</button>
          <button className="act" title="Move to trash" aria-label="Move to trash" onClick={(e) => { e.stopPropagation(); void trashPage(p.id); if (current === p.id) go("#/"); }}>🗑</button>
        </div>
        {isOpen && kids.map((c) => row(c, depth + 1))}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="side-head">📓 Daybook</div>
      <input className="search" placeholder="Search…" aria-label="Search pages" value={q} onChange={(e) => setQ(e.target.value)} />
      <button className="side-btn" onClick={async () => go(`#/page/${(await dailyPage()).id}`)}>📅 Today</button>
      <button className="side-btn" onClick={async () => go(`#/page/${(await createPage()).id}`)}>＋ New page</button>
      <button className="side-btn" onClick={async () => go(`#/page/${(await createPage({ kind: "database" })).id}`)}>▦ New database</button>

      <nav className="tree" aria-label="Pages">
        {results ? (
          <>
            <div className="group">Results</div>
            {results.length === 0 && <div className="empty">No matches</div>}
            {results.map((p) => (
              <div key={p.id} className={"node" + (p.id === current ? " active" : "")} onClick={() => { go(`#/page/${p.id}`); setQ(""); }}>
                <span className="name">{p.title || "Untitled"}</span>
              </div>
            ))}
          </>
        ) : (
          <>
            {daily.length > 0 && (
              <>
                <div className="group">Daily notes</div>
                {daily.slice(0, 7).map((p) => (
                  <div key={p.id} className={"node" + (p.id === current ? " active" : "")} onClick={() => go(`#/page/${p.id}`)}>
                    <span className="name">{p.title}</span>
                  </div>
                ))}
              </>
            )}
            <div className="group">Pages</div>
            {(byParent.get(null) ?? []).length === 0 && <div className="empty">No pages yet</div>}
            {(byParent.get(null) ?? []).map((p) => row(p, 0))}
          </>
        )}
      </nav>

      <button className="side-btn" onClick={() => go("#/trash")}>🗑 Trash{trashCount ? ` (${trashCount})` : ""}</button>
      <div className="side-foot">
        <button className="side-btn small" onClick={toggleTheme}>{theme === "dark" ? "☀ Light" : "🌙 Dark"}</button>
        <button className="side-btn small" onClick={() => void exportJSON()}>⬇ Backup</button>
        <button className="side-btn small" onClick={() => importRef.current?.click()}>⬆ Restore</button>
        <input ref={importRef} type="file" accept=".json" hidden onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = "";
          if (!f) return;
          try { alert(`Restored ${await importJSON(f)} pages`); } catch (x) { alert((x as Error).message); }
        }} />
      </div>
      <div className="user">
        <button className="status" onClick={() => void syncNow()} title="Sync now">{statusText(status)}</button>
        <span className="who">{user} · <button className="linklike" onClick={onLogout}>Sign out</button></span>
      </div>
    </aside>
  );
}
