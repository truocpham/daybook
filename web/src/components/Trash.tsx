import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { restorePage } from "../lib/store";
import type { Page } from "../lib/types";

export default function Trash({ go }: { go: (h: string) => void }) {
  const items = useLiveQuery(() => db.pages.filter((p) => !!p.deleted_at).toArray(), [], [] as Page[]);
  return (
    <div className="page">
      <h2 className="trash-h">Trash</h2>
      <p className="hint">Restore a page to bring it back. Trashed pages stay on the server so they can be recovered.</p>
      {items.length === 0 && <p className="empty">Trash is empty.</p>}
      <ul className="trash">
        {items.sort((a, b) => (b.deleted_at ?? 0) - (a.deleted_at ?? 0)).map((p) => (
          <li key={p.id}>
            <span>{p.title || "Untitled"} <small>{new Date((p.deleted_at ?? 0) * 1000).toLocaleString()}</small></span>
            <button onClick={async () => { await restorePage(p.id); go(`#/page/${p.id}`); }}>Restore</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
