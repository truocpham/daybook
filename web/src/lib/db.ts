import Dexie, { type Table } from "dexie";
import type { BlobRec, Page } from "./types";

class DaybookDB extends Dexie {
  pages!: Table<Page, string>;
  blobs!: Table<BlobRec, string>;
  meta!: Table<{ key: string; value: any }, string>;
  constructor() {
    super("daybook");
    this.version(1).stores({
      pages: "id,parent_id,daily_date,dirty,deleted_at,seq",
      blobs: "sha,uploaded",
      meta: "key",
    });
  }
}

export const db = new DaybookDB();

export async function getMeta<T = any>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value;
}
export function setMeta(key: string, value: any) {
  return db.meta.put({ key, value });
}
