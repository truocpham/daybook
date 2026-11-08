export type ColumnType = "text" | "number" | "select" | "date" | "checkbox";
export interface Column { id: string; name: string; type: ColumnType }
export interface DbSchema { columns: Column[] }

export interface Page {
  id: string;
  parent_id: string | null;
  title: string;
  kind: "page" | "database";
  position: string;
  content: any | null; // TipTap JSON document
  props: Record<string, any> | null; // database row values, keyed by column id
  schema: DbSchema | null; // database column definitions
  daily_date: string | null; // YYYY-MM-DD for daily notes
  deleted_at: number | null;
  seq: number; // last server seq seen for this page
  // local-only bookkeeping
  dirty: 0 | 1;
  rev: number; // bumped on every local edit
}

export interface BlobRec { sha: string; blob: Blob; mime: string; name?: string; size: number; uploaded: 0 | 1 }
