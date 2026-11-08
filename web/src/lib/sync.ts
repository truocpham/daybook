import { api, HttpError } from "./api";
import { db, getMeta, setMeta } from "./db";
import type { Page } from "./types";

export type SyncStatus = { state: "idle" | "syncing" | "offline" | "error" | "unauth"; last: number | null };
let status: SyncStatus = { state: "idle", last: null };
const listeners = new Set<() => void>();
export const getStatus = () => status;
export const subscribeStatus = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
function setStatus(s: Partial<SyncStatus>) {
  status = { ...status, ...s };
  listeners.forEach((f) => f());
}

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let again = false;
let enabled = false;

export function enableSync(on: boolean) {
  enabled = on;
  if (on) scheduleSync(200);
}

export function scheduleSync(ms = 1500) {
  if (!enabled) return;
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), ms);
}

async function uploadBlobs() {
  const pending = await db.blobs.where("uploaded").equals(0).toArray();
  for (const b of pending) {
    const res = await fetch(`/files/${b.sha}`, {
      method: "PUT",
      body: b.blob,
      headers: { "content-type": b.mime },
      credentials: "same-origin",
    });
    if (res.status === 401) throw new HttpError(401);
    // 400 means the server rejected it for good (size or hash): stop retrying
    if (res.ok || res.status === 400) await db.blobs.update(b.sha, { uploaded: 1 });
  }
}

const wire = (p: Page) => ({
  id: p.id,
  parent_id: p.parent_id,
  title: p.title,
  kind: p.kind,
  position: p.position,
  content: p.content,
  props: p.props,
  schema: p.schema,
  daily_date: p.daily_date,
  deleted_at: p.deleted_at,
  base_seq: p.seq,
});

let current: Promise<void> | null = null;

/** Runs a sync, or joins the one in progress. Resolves when it has finished (also on failure). */
export function syncNow(): Promise<void> {
  if (!enabled) return Promise.resolve();
  if (current) {
    again = true;
    return current;
  }
  current = run().finally(() => {
    current = null;
  });
  return current;
}

async function run(): Promise<void> {
  running = true;
  setStatus({ state: "syncing" });
  try {
    await uploadBlobs();
    for (let round = 0; round < 25; round++) {
      const cursor = (await getMeta<number>("cursor")) ?? 0;
      const dirty = await db.pages.where("dirty").equals(1).limit(200).toArray();
      const pushedRev = new Map(dirty.map((p) => [p.id, p.rev]));
      const res = await api.sync({ cursor, changes: dirty.map(wire) });
      await db.transaction("rw", db.pages, db.meta, async () => {
        for (const sp of res.pages) {
          const local = await db.pages.get(sp.id);
          const editedSince = local && local.dirty && local.rev !== pushedRev.get(sp.id);
          if (editedSince) {
            // keep the newer local edit; just remember which server version it builds on
            await db.pages.update(sp.id, { seq: sp.seq });
            continue;
          }
          await db.pages.put({
            ...sp,
            content: sp.content ?? null,
            props: sp.props ?? null,
            schema: sp.schema ?? null,
            dirty: 0,
            rev: local?.rev ?? 0,
          });
        }
        await setMeta("cursor", res.cursor);
      });
      const left = await db.pages.where("dirty").equals(1).count();
      if (!res.more && (left === 0 || dirty.length === 0)) break;
    }
    setStatus({ state: "idle", last: Date.now() });
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) setStatus({ state: "unauth" });
    else if (e instanceof HttpError) setStatus({ state: "error" });
    else setStatus({ state: "offline" });
  } finally {
    running = false;
    if (again) {
      again = false;
      scheduleSync(500);
    }
  }
}

export function startSyncTriggers() {
  window.addEventListener("online", () => scheduleSync(200));
  window.addEventListener("focus", () => scheduleSync(300));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleSync(300);
  });
  setInterval(() => scheduleSync(0), 60_000);
}
