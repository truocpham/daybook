import { useState } from "react";
import { createPage, updatePage } from "../lib/store";
import type { Column, Page } from "../lib/types";

/** Kanban view: one column per value of a "select" property. Drag a card to change its value. */
export default function Board({ dbId, rows, cols, go }: { dbId: string; rows: Page[]; cols: Column[]; go: (h: string) => void }) {
  const selects = cols.filter((c) => c.type === "select");
  const [groupId, setGroupId] = useState<string>(selects[0]?.id ?? "");
  const [extra, setExtra] = useState<string[]>([]);
  const [over, setOver] = useState<string | null>(null);
  const group = selects.find((c) => c.id === groupId) ?? selects[0];

  if (!group) {
    return <p className="hint">Add a column of type <b>select</b> (for example “Status”) to group cards on a board.</p>;
  }

  const valueOf = (r: Page) => String(r.props?.[group.id] ?? "");
  const lanes = [...new Set([...rows.map(valueOf).filter(Boolean), ...extra])];
  const hasNone = rows.some((r) => !valueOf(r));
  const all = hasNone || lanes.length === 0 ? ["", ...lanes] : lanes;
  const others = cols.filter((c) => c.id !== group.id && c.type !== "checkbox").slice(0, 2);

  const drop = (value: string, e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    const row = rows.find((r) => r.id === e.dataTransfer.getData("text/plain"));
    if (row && valueOf(row) !== value) void updatePage(row.id, { props: { ...(row.props ?? {}), [group.id]: value } });
  };

  return (
    <div className="board">
      <div className="board-tools">
        {selects.length > 1 && (
          <label>
            Group by{" "}
            <select value={group.id} onChange={(e) => setGroupId(e.target.value)}>
              {selects.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        <button onClick={() => { const n = window.prompt(`New ${group.name} value`)?.trim(); if (n) setExtra([...extra, n]); }}>＋ Add group</button>
      </div>
      <div className="lanes">
        {all.map((v) => (
          <section
            key={v || "_none"}
            className={"lane" + (over === v ? " over" : "")}
            aria-label={v || "No value"}
            onDragOver={(e) => { e.preventDefault(); setOver(v); }}
            onDragLeave={() => setOver((o) => (o === v ? null : o))}
            onDrop={(e) => drop(v, e)}
          >
            <h3>{v || "No value"} <small>{rows.filter((r) => valueOf(r) === v).length}</small></h3>
            {rows.filter((r) => valueOf(r) === v).sort((a, b) => (a.position < b.position ? -1 : 1)).map((r) => (
              <article
                key={r.id}
                className="card"
                draggable
                onDragStart={(e) => { e.dataTransfer.setData("text/plain", r.id); e.dataTransfer.effectAllowed = "move"; }}
                onClick={() => go(`#/page/${r.id}`)}
              >
                <b>{r.title || "Untitled"}</b>
                {others.map((c) => (r.props?.[c.id] ? <small key={c.id}>{c.name}: {String(r.props[c.id])}</small> : null))}
              </article>
            ))}
            <button className="lane-add" onClick={async () => { await createPage({ parent_id: dbId, title: "", props: v ? { [group.id]: v } : null }); }}>＋ New</button>
          </section>
        ))}
      </div>
    </div>
  );
}
