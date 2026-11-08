import { describe, expect, it } from "vitest";
import { canonical, dailyTitle, docText, shiftDate } from "./text";
import { docToMarkdown } from "./markdown";

const doc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Tasks" }] },
    { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "ship it" }] }] }] },
    { type: "paragraph", content: [{ type: "text", text: "bold", marks: [{ type: "bold" }] }] },
  ],
};

describe("text helpers", () => {
  it("extracts text", () => expect(docText(doc)).toContain("ship it"));
  it("shifts dates across month ends", () => {
    expect(shiftDate("2026-11-30", 1)).toBe("2026-12-01");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("titles daily notes", () => expect(dailyTitle("2026-11-08")).toBe("2026-11-08 Sun"));
  it("compares documents regardless of key order", () => {
    expect(canonical({ b: 1, a: { d: [1, { y: 1, x: 2 }], c: null } })).toBe(canonical({ a: { c: null, d: [1, { x: 2, y: 1 }] }, b: 1 }));
    expect(canonical({ a: 1 })).not.toBe(canonical({ a: 2 }));
  });
  it("exports markdown", () => {
    const md = docToMarkdown(doc);
    expect(md).toContain("## Tasks");
    expect(md).toContain("- [x] ship it");
    expect(md).toContain("**bold**");
  });
});
