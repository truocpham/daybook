import { generateKeyBetween } from "fractional-indexing";
import { db } from "./db";
import { dailyTemplate, dailyTitle, emptyDoc, isoDate } from "./text";
import type { Page } from "./types";
import { scheduleSync } from "./sync";

export const uid = () => crypto.randomUUID();

/** Position that sorts after every sibling currently under `parent`. */
async function lastPosition(parent: string | null): Promise<string> {
  const sibs = await db.pages
    .filter((p) => p.parent_id === parent && !p.deleted_at && !p.daily_date)
    .toArray();
  const max = sibs.map((s) => s.position).sort().pop() ?? null;
  return generateKeyBetween(max, null);
}

export async function createPage(opts: Partial<Page> = {}): Promise<Page> {
  const parent = opts.parent_id ?? null;
  const kind = opts.kind ?? "page";
  const p: Page = {
    id: uid(),
    parent_id: parent,
    title: "",
    kind,
    position: await lastPosition(parent),
    content: kind === "page" ? emptyDoc() : null,
    props: null,
    schema:
      kind === "database"
        ? {
            columns: [
              { id: uid().slice(0, 8), name: "Status", type: "select" },
              { id: uid().slice(0, 8), name: "Due", type: "date" },
            ],
          }
        : null,
    daily_date: null,
    deleted_at: null,
    seq: 0,
    dirty: 1,
    rev: 1,
    ...opts,
  };
  await db.pages.put(p);
  scheduleSync();
  return p;
}

export async function updatePage(id: string, patch: Partial<Page>) {
  await db.pages
    .where("id")
    .equals(id)
    .modify((p) => {
      Object.assign(p, patch);
      p.dirty = 1;
      p.rev = (p.rev ?? 0) + 1;
    });
  scheduleSync();
}

export async function trashPage(id: string) {
  await updatePage(id, { deleted_at: Math.floor(Date.now() / 1000) });
}

export async function restorePage(id: string) {
  const p = await db.pages.get(id);
  // a restored page whose parent is trashed would be unreachable: move it to the top level
  const parent = p?.parent_id ? await db.pages.get(p.parent_id) : null;
  await updatePage(id, { deleted_at: null, ...(parent && !parent.deleted_at ? {} : { parent_id: null }) });
}

/** Open (creating if needed) the daily note for an ISO date. */
export async function dailyPage(iso: string = isoDate()): Promise<Page> {
  const existing = await db.pages
    .where("daily_date")
    .equals(iso)
    .filter((p) => !p.deleted_at)
    .first();
  if (existing) return existing;
  return createPage({ title: dailyTitle(iso), daily_date: iso, content: dailyTemplate(), position: "a0" });
}

/** Move `id` next to `target`: before it, after it, or as its last child. */
export async function movePage(id: string, target: string, where: "before" | "after" | "inside") {
  if (id === target) return;
  const [moving, dest] = await Promise.all([db.pages.get(id), db.pages.get(target)]);
  if (!moving || !dest || dest.daily_date || moving.daily_date) return;
  // refuse to move a page into its own subtree
  let cur: Page | undefined = dest;
  while (cur) {
    if (cur.id === id) return;
    cur = cur.parent_id ? await db.pages.get(cur.parent_id) : undefined;
  }
  if (where === "inside") {
    await updatePage(id, { parent_id: dest.id, position: await lastPosition(dest.id) });
    return;
  }
  const sibs = (
    await db.pages
      .filter((p) => p.parent_id === dest.parent_id && !p.deleted_at && !p.daily_date && p.id !== id)
      .toArray()
  ).sort((a, b) => (a.position < b.position ? -1 : 1));
  const i = sibs.findIndex((s) => s.id === dest.id);
  const [lo, hi] =
    where === "before"
      ? [sibs[i - 1]?.position ?? null, dest.position]
      : [dest.position, sibs[i + 1]?.position ?? null];
  await updatePage(id, { parent_id: dest.parent_id, position: generateKeyBetween(lo, hi) });
}
