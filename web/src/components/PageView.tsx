import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { dailyPage, trashPage, updatePage } from "../lib/store";
import { shiftDate } from "../lib/text";
import { exportMarkdown } from "../lib/exportImport";
import Editor from "../editor/Editor";
import DatabaseView from "./DatabaseView";
import type { Page } from "../lib/types";

export default function PageView({ id, go }: { id: string; go: (h: string) => void }) {
  const page = useLiveQuery(() => db.pages.get(id), [id]);
  const [title, setTitle] = useState("");
  const [crumbs, setCrumbs] = useState<Page[]>([]);

  useEffect(() => { if (page) setTitle(page.title); }, [page?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    (async () => {
      const chain: Page[] = [];
      let cur = page?.parent_id ? await db.pages.get(page.parent_id) : undefined;
      while (cur && chain.length < 20) { chain.unshift(cur); cur = cur.parent_id ? await db.pages.get(cur.parent_id) : undefined; }
      if (alive) setCrumbs(chain);
    })();
    return () => { alive = false; };
  }, [page?.parent_id]);

  // Two devices made the same day's note offline and the server merged them: follow it to the survivor.
  const mergedDay = page?.deleted_at && page.daily_date ? page.daily_date : null;
  useEffect(() => {
    if (!mergedDay) return;
    void db.pages.where("daily_date").equals(mergedDay).filter((p) => !p.deleted_at).first().then((p) => p && go(`#/page/${p.id}`));
  }, [mergedDay, go]);

  if (page === undefined) return <div className="empty-state">Loading…</div>;
  if (!page || page.deleted_at) {
    return (
      <div className="empty-state">
        <p>This page is not available. It may be in the trash or not synced to this device yet.</p>
        <button onClick={() => go("#/")}>Go to today</button>
      </div>
    );
  }

  const step = async (n: number) => go(`#/page/${(await dailyPage(shiftDate(page.daily_date!, n))).id}`);

  return (
    <div className="page">
      <div className="crumbs">
        {crumbs.map((c) => (<span key={c.id}><a href={`#/page/${c.id}`}>{c.title || "Untitled"}</a> / </span>))}
        <span>{page.title || "Untitled"}</span>
        <span className="spacer" />
        {page.daily_date && (
          <span className="daynav">
            <button onClick={() => step(-1)} aria-label="Previous day">‹</button>
            <button onClick={async () => go(`#/page/${(await dailyPage()).id}`)}>Today</button>
            <button onClick={() => step(1)} aria-label="Next day">›</button>
          </span>
        )}
        {page.kind === "page" && <button className="ghost" onClick={() => exportMarkdown(page)}>Export .md</button>}
        <button className="ghost" onClick={() => { void trashPage(page.id); go("#/"); }}>Move to trash</button>
      </div>
      <input
        className="title"
        aria-label="Page title"
        placeholder="Untitled"
        value={title}
        onChange={(e) => { setTitle(e.target.value); void updatePage(page.id, { title: e.target.value }); }}
      />
      {page.kind === "database" ? <DatabaseView page={page} go={go} /> : <Editor key={page.id} page={page} />}
    </div>
  );
}
