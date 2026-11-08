/** Plain text of a TipTap/ProseMirror JSON document. */
export function docText(node: any): string {
  if (!node) return "";
  let out = "";
  if (typeof node.text === "string") out += node.text;
  if (Array.isArray(node.content)) {
    for (const c of node.content) out += docText(c);
    if (node.type && node.type !== "doc" && node.type !== "text") out += "\n";
  }
  return out;
}

/** JSON.stringify with sorted keys, so documents compare equal whatever order a server returned them in. */
export function canonical(v: any): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

export function emptyDoc() {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

export function dailyTemplate() {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Tasks" }] },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] }] },
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Notes" }] },
      { type: "paragraph" },
    ],
  };
}

export function isoDate(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
}

export function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + days));
}

export function dailyTitle(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short" });
  return `${iso} ${wd}`;
}
