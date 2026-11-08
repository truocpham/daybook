/** TipTap JSON -> Markdown, for export. */
function inline(nodes: any[] | undefined): string {
  return (nodes ?? [])
    .map((n) => {
      if (n.type === "hardBreak") return "  \n";
      let t: string = n.text ?? "";
      for (const m of n.marks ?? []) {
        if (m.type === "code") t = "`" + t + "`";
        else if (m.type === "bold") t = `**${t}**`;
        else if (m.type === "italic") t = `*${t}*`;
        else if (m.type === "strike") t = `~~${t}~~`;
        else if (m.type === "link") t = `[${t}](${m.attrs?.href ?? ""})`;
      }
      return t;
    })
    .join("");
}

function block(n: any, indent = ""): string {
  switch (n.type) {
    case "paragraph": return indent + inline(n.content);
    case "heading": return "#".repeat(n.attrs?.level ?? 1) + " " + inline(n.content);
    case "blockquote": return (n.content ?? []).map((c: any) => "> " + block(c)).join("\n");
    case "codeBlock": return "```" + (n.attrs?.language ?? "") + "\n" + (n.content ?? []).map((c: any) => c.text).join("") + "\n```";
    case "horizontalRule": return "---";
    case "bulletList": return (n.content ?? []).map((li: any) => listItem(li, indent, "- ")).join("\n");
    case "orderedList": return (n.content ?? []).map((li: any, i: number) => listItem(li, indent, `${i + 1}. `)).join("\n");
    case "taskList": return (n.content ?? []).map((li: any) => listItem(li, indent, li.attrs?.checked ? "- [x] " : "- [ ] ")).join("\n");
    case "image": return `![${n.attrs?.alt ?? ""}](files/${n.attrs?.sha ?? ""})`;
    case "file": return `[${n.attrs?.name ?? "file"}](files/${n.attrs?.sha ?? ""})`;
    default: return inline(n.content);
  }
}

function listItem(li: any, indent: string, marker: string): string {
  const [first, ...rest] = li.content ?? [];
  const head = indent + marker + (first ? block(first) : "");
  const tail = rest.map((c: any) => (c.type.endsWith("List") ? block(c, indent + "  ") : indent + "  " + block(c)));
  return [head, ...tail].join("\n");
}

export function docToMarkdown(doc: any): string {
  return (doc?.content ?? []).map((n: any) => block(n)).join("\n\n") + "\n";
}
