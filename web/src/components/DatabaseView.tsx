import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { createPage, trashPage, uid, updatePage } from "../lib/store";
import type { Column, ColumnType, Page } from "../lib/types";

const TYPES: ColumnType[] = ["text", "number", "select", "date", "checkbox"];

export default function DatabaseView({ page, go }: { page: Page; go: (h: string) => void }) {
  const rows = useLiveQuery(() => db.pages.filter((p) => p.parent_id === page.id && !p.deleted_at).toArray(), [page.id], [] as Page[]);
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const [filter, setFilter] = useState("");
  const cols: Column[] = page.schema?.columns ?? [];

  const setCols = (columns: Column[]) => updatePage(page.id, { schema: { columns } });

  const view = useMemo(() => {
    const f = filter.trim().toLowerCase();
    let out = rows.filter((r) => !f || r.title.toLowerCase().includes(f) || cols.some((c) => String(r.props?.[c.id] ?? "").toLowerCase().includes(f)));
    if (sort) {
      const get = (r: Page) => (sort.col === "_title" ? r.title : r.props?.[sort.col] ?? "");
      out = [...out].sort((a, b) => {
        const x = get(a), y = get(b);
        return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
      });
    } else {
      out = [...out].sort((a, b) => (a.position < b.position ? -1 : 1));
    }
    return out;
  }, [rows, sort, filter, cols]);

  const options = (c: Column) => [...new Set(rows.map((r) => r.props?.[c.id]).filter(Boolean))] as string[];
  const setCell = (r: Page, c: Column, v: any) => updatePage(r.id, { props: { ...(r.props ?? {}), [c.id]: v } });
  const toggleSort = (col: string) => setSort(sort?.col === col ? (sort.dir === 1 ? { col, dir: -1 } : null) : { col, dir: 1 });

  const addColumn = () => {
    const name = window.prompt("Column name");
    if (!name) return;
    const type = (window.prompt(`Column type: ${TYPES.join(", ")}`, "text") ?? "text").trim() as ColumnType;
    setCols([...cols, { id: uid().slice(0, 8), name, type: TYPES.includes(type) ? type : "text" }]);
  };

  return (
    <div className="dbview">
      <div className="db-tools">
        <input aria-label="Filter rows" placeholder="Filter rows…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button onClick={async () => { await createPage({ parent_id: page.id, title: "" }); }}>＋ New row</button>
        <button onClick={addColumn}>＋ Column</button>
      </div>
      <div className="db-scroll">
        <table>
          <thead>
            <tr>
              <th><button className="th" onClick={() => toggleSort("_title")}>Name {sort?.col === "_title" ? (sort.dir === 1 ? "↑" : "↓") : ""}</button></th>
              {cols.map((c) => (
                <th key={c.id}>
                  <button className="th" onClick={() => toggleSort(c.id)}>{c.name} <small>{c.type}</small> {sort?.col === c.id ? (sort.dir === 1 ? "↑" : "↓") : ""}</button>
                  <button className="th-x" title="Delete column" aria-label={`Delete column ${c.name}`} onClick={() => window.confirm(`Delete column "${c.name}"? Values stay in the rows but are hidden.`) && setCols(cols.filter((x) => x.id !== c.id))}>×</button>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {view.map((r) => (
              <tr key={r.id}>
                <td>
                  <input aria-label="Row name" value={r.title} placeholder="Untitled" onChange={(e) => updatePage(r.id, { title: e.target.value })} />
                  <button className="open" title="Open as page" aria-label="Open row as page" onClick={() => go(`#/page/${r.id}`)}>↗</button>
                </td>
                {cols.map((c) => (
                  <td key={c.id}>
                    {c.type === "checkbox" ? (
                      <input type="checkbox" aria-label={c.name} checked={!!r.props?.[c.id]} onChange={(e) => setCell(r, c, e.target.checked)} />
                    ) : c.type === "select" ? (
                      <>
                        <input aria-label={c.name} list={`${page.id}-${c.id}`} value={r.props?.[c.id] ?? ""} onChange={(e) => setCell(r, c, e.target.value)} />
                        <datalist id={`${page.id}-${c.id}`}>{options(c).map((o) => <option key={o} value={o} />)}</datalist>
                      </>
                    ) : (
                      <input aria-label={c.name} type={c.type === "number" ? "number" : c.type === "date" ? "date" : "text"} value={r.props?.[c.id] ?? ""} onChange={(e) => setCell(r, c, c.type === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value)} />
                    )}
                  </td>
                ))}
                <td><button className="open" title="Move row to trash" aria-label="Move row to trash" onClick={() => trashPage(r.id)}>🗑</button></td>
              </tr>
            ))}
            {view.length === 0 && (
              <tr><td colSpan={cols.length + 2} className="empty">{rows.length ? "No rows match the filter." : "No rows yet. Add one with “New row”."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
