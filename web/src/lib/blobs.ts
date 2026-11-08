import { db } from "./db";
import { scheduleSync } from "./sync";

export const MAX_IMAGE_EDGE = 1600;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

async function sha256(blob: Blob): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function canvasBlob(c: HTMLCanvasElement, type: string, q: number): Promise<Blob | null> {
  return new Promise((r) => c.toBlob(r, type, q));
}

/** Shrink large photos before they are stored and uploaded. GIFs are kept as they are. */
async function shrink(file: File): Promise<Blob> {
  if (file.type === "image/gif" || !file.type.startsWith("image/")) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 400_000) return file;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    const out = (await canvasBlob(c, "image/webp", 0.85)) ?? (await canvasBlob(c, "image/jpeg", 0.85));
    return out && out.size < file.size ? out : file;
  } catch {
    return file;
  }
}

export interface StoredFile { sha: string; mime: string; size: number; name: string }

/** Save a picked/pasted file locally; it uploads on the next sync. */
export async function storeFile(file: File, asImage: boolean): Promise<StoredFile> {
  const blob = asImage ? await shrink(file) : file;
  if (blob.size > MAX_FILE_BYTES) throw new Error(`File is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  const sha = await sha256(blob);
  const mime = blob.type || "application/octet-stream";
  if (!(await db.blobs.get(sha))) await db.blobs.put({ sha, blob, mime, size: blob.size, name: file.name, uploaded: 0 });
  scheduleSync(500);
  return { sha, mime, size: blob.size, name: file.name };
}

/** Local copy if we have one, otherwise fetch from the server and keep it for offline use. */
export async function loadBlob(sha: string): Promise<Blob | null> {
  const local = await db.blobs.get(sha);
  if (local) return local.blob;
  try {
    const res = await fetch(`/files/${sha}`, { credentials: "same-origin" });
    if (!res.ok) return null;
    const blob = await res.blob();
    await db.blobs.put({ sha, blob, mime: blob.type, size: blob.size, uploaded: 1 });
    return blob;
  } catch {
    return null;
  }
}
