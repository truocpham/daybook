import { db } from "./db";
import { docToMarkdown } from "./markdown";
import { scheduleSync } from "./sync";
import type { Page } from "./types";

function download(name: string, data: BlobPart, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

const safeName = (s: string) => (s || "Untitled").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80);

export async function exportJSON() {
  const pages = (await db.pages.toArray()).map(({ dirty, rev, ...p }) => p);
  download(`daybook-${new Date().toLocaleDateString("en-CA")}.json`, JSON.stringify({ version: 1, pages }, null, 2), "application/json");
}

export function exportMarkdown(page: Page) {
  const body = page.kind === "page" ? docToMarkdown(page.content) : "";
  download(`${safeName(page.title)}.md`, `# ${page.title || "Untitled"}\n\n${body}`, "text/markdown");
}

export async function importJSON(file: File): Promise<number> {
  const data = JSON.parse(await file.text());
  if (!Array.isArray(data?.pages)) throw new Error("This is not a Daybook backup file");
  const pages: Page[] = data.pages.filter((p: any) => typeof p?.id === "string").map((p: any) => ({
    id: p.id,
    parent_id: p.parent_id ?? null,
    title: String(p.title ?? ""),
    kind: p.kind === "database" ? "database" : "page",
    position: p.position ?? "a0",
    content: p.content ?? null,
    props: p.props ?? null,
    schema: p.schema ?? null,
    daily_date: p.daily_date ?? null,
    deleted_at: p.deleted_at ?? null,
    seq: 0,
    dirty: 1,
    rev: 1,
  }));
  await db.pages.bulkPut(pages);
  scheduleSync();
  return pages.length;
}
