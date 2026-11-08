import { useEffect, useMemo, useRef, useState } from "react";
import { BubbleMenu, EditorContent, useEditor, type Editor as TipTapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { NodeSelection } from "@tiptap/pm/state";
import { FileBlock, ImageBlock } from "./nodes";
import { storeFile } from "../lib/blobs";
import { updatePage } from "../lib/store";
import { canonical, emptyDoc } from "../lib/text";
import type { Page } from "../lib/types";

interface SlashItem { title: string; hint: string; run: (e: TipTapEditor, pick: (kind: "image" | "file") => void) => void }

const ITEMS: SlashItem[] = [
  { title: "Text", hint: "plain paragraph", run: (e) => e.chain().focus().setParagraph().run() },
  { title: "Heading 1", hint: "#", run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { title: "Heading 2", hint: "##", run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { title: "Heading 3", hint: "###", run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { title: "To-do list", hint: "[]", run: (e) => e.chain().focus().toggleTaskList().run() },
  { title: "Bullet list", hint: "-", run: (e) => e.chain().focus().toggleBulletList().run() },
  { title: "Numbered list", hint: "1.", run: (e) => e.chain().focus().toggleOrderedList().run() },
  { title: "Quote", hint: ">", run: (e) => e.chain().focus().toggleBlockquote().run() },
  { title: "Code block", hint: "```", run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { title: "Divider", hint: "---", run: (e) => e.chain().focus().setHorizontalRule().run() },
  { title: "Image", hint: "upload or paste", run: (_e, pick) => pick("image") },
  { title: "File", hint: "attach up to 10 MB", run: (_e, pick) => pick("file") },
];

interface SlashState { from: number; query: string; x: number; y: number }

export default function Editor({ page }: { page: Page }) {
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [sel, setSel] = useState(0);
  const slashRef = useRef<{ s: SlashState | null; items: SlashItem[]; sel: number }>({ s: null, items: [], sel: 0 });
  const fileInput = useRef<HTMLInputElement>(null);
  const pickKind = useRef<"image" | "file">("image");
  const wrap = useRef<HTMLDivElement>(null);
  const [handle, setHandle] = useState<{ top: number; pos: number } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const lastSeq = useRef(page.seq);
  const pending = useRef(false); // typed but not yet written to the local database

  const items = useMemo(() => {
    const q = slash?.query.toLowerCase() ?? "";
    return ITEMS.filter((i) => i.title.toLowerCase().includes(q));
  }, [slash?.query]);
  slashRef.current = { s: slash, items, sel };

  const insertFiles = async (editor: TipTapEditor, files: File[], at?: number) => {
    for (const f of files) {
      try {
        const isImg = f.type.startsWith("image/");
        const st = await storeFile(f, isImg);
        const node = isImg
          ? { type: "image", attrs: { sha: st.sha, alt: f.name } }
          : { type: "file", attrs: { sha: st.sha, name: f.name, size: st.size } };
        editor.chain().focus().insertContentAt(at ?? editor.state.selection.to, node).run();
      } catch (e) {
        alert((e as Error).message);
      }
    }
  };

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        Link.configure({ openOnClick: false, autolink: true }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Placeholder.configure({ placeholder: "Type '/' for commands" }),
        ImageBlock,
        FileBlock,
      ],
      content: page.content ?? emptyDoc(),
      editorProps: {
        handleKeyDown: (_v, ev) => {
          const { s, items: its, sel: cur } = slashRef.current;
          if (!s || !its.length) return false;
          if (ev.key === "ArrowDown") { setSel((cur + 1) % its.length); return true; }
          if (ev.key === "ArrowUp") { setSel((cur - 1 + its.length) % its.length); return true; }
          if (ev.key === "Escape") { setSlash(null); return true; }
          if (ev.key === "Enter" || ev.key === "Tab") { runSlash(its[cur]); return true; }
          return false;
        },
        handlePaste: (_v, ev) => {
          const files = [...(ev.clipboardData?.files ?? [])];
          if (!files.length || !editorRef.current) return false;
          void insertFiles(editorRef.current, files);
          return true;
        },
        handleDrop: (view, ev) => {
          const files = [...(ev.dataTransfer?.files ?? [])];
          if (!files.length || !editorRef.current) return false;
          const at = view.posAtCoords({ left: ev.clientX, top: ev.clientY })?.pos;
          void insertFiles(editorRef.current, files, at);
          return true;
        },
        attributes: { spellcheck: "true" },
      },
      onUpdate: ({ editor }) => {
        clearTimeout(saveTimer.current);
        pending.current = true;
        saveTimer.current = setTimeout(() => {
          pending.current = false;
          void updatePage(page.id, { content: editor.getJSON() });
        }, 400);
      },
      onTransaction: ({ editor }) => {
        const { selection } = editor.state;
        const $from = selection.$from;
        if (!selection.empty || $from.parent.type.name !== "paragraph") return setSlash(null);
        const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
        const m = /(?:^|\s)\/([\w ]{0,20})$/.exec(before);
        if (!m) return setSlash(null);
        const coords = editor.view.coordsAtPos($from.pos);
        setSlash({ from: $from.pos - m[1].length - 1, query: m[1], x: coords.left, y: coords.bottom + 6 });
      },
    },
    [page.id],
  );
  const editorRef = useRef<TipTapEditor | null>(null);
  editorRef.current = editor;

  // flush pending edits when leaving the page
  useEffect(
    () => () => {
      if (pending.current && editorRef.current && !editorRef.current.isDestroyed) {
        clearTimeout(saveTimer.current);
        pending.current = false;
        void updatePage(page.id, { content: editorRef.current.getJSON() });
      }
    },
    [page.id],
  );

  // a newer version arrived from the server while this page was open and untouched locally
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (page.seq !== lastSeq.current && !page.dirty && !pending.current) {
      lastSeq.current = page.seq;
      if (canonical(editor.getJSON()) !== canonical(page.content)) {
        editor.commands.setContent(page.content ?? emptyDoc(), false);
      }
    }
  }, [page.seq, page.dirty, page.content, editor]);

  useEffect(() => setSel(0), [slash?.query]);

  function runSlash(item: SlashItem) {
    const ed = editorRef.current;
    const s = slashRef.current.s;
    if (!ed || !s) return;
    ed.chain().focus().deleteRange({ from: s.from, to: ed.state.selection.from }).run();
    setSlash(null);
    item.run(ed, (kind) => {
      pickKind.current = kind;
      if (fileInput.current) {
        fileInput.current.accept = kind === "image" ? "image/*" : "";
        fileInput.current.click();
      }
    });
  }

  // drag handle: follows the top-level block under the pointer
  const onMove = (e: React.MouseEvent) => {
    if (!editor || editor.isDestroyed || !wrap.current) return;
    const box = wrap.current.getBoundingClientRect();
    const hit = editor.view.posAtCoords({ left: box.left + 60, top: e.clientY });
    if (!hit) return setHandle(null);
    const doc = editor.state.doc;
    const at = hit.inside >= 0 ? hit.inside : hit.pos;
    const $p = doc.resolve(Math.min(at, doc.content.size));
    const start = $p.depth >= 1 ? $p.before(1) : at;
    const dom = editor.view.nodeDOM(start) as HTMLElement | null;
    if (!dom || !doc.nodeAt(start)) return setHandle(null);
    setHandle({ top: dom.getBoundingClientRect().top - box.top + 2, pos: start });
  };
  const onDragStart = (e: React.DragEvent) => {
    if (!editor || !handle) return;
    const { view } = editor;
    const ns = NodeSelection.create(view.state.doc, handle.pos);
    view.dispatch(view.state.tr.setSelection(ns));
    (view as any).dragging = { slice: ns.content(), move: true };
    const dom = view.nodeDOM(handle.pos) as HTMLElement;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", "");
    if (dom) e.dataTransfer.setDragImage(dom, 0, 0);
  };

  const setLink = () => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link address (empty to remove)", prev ?? "https://");
    if (url === null) return;
    if (url === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="editor-wrap" ref={wrap} onMouseMove={onMove} onMouseLeave={() => setHandle(null)}>
      {handle && (
        <div className="grip" style={{ top: handle.top }} draggable onDragStart={onDragStart} title="Drag to move" aria-label="Drag to move block">
          ⋮⋮
        </div>
      )}
      {/* BubbleMenu moves its element out of the React tree, so it gets a host of its own: siblings then never
          insert next to a node React no longer owns */}
      <div className="bubble-host">
      {editor && (
        <BubbleMenu editor={editor} tippyOptions={{ duration: 100 }} className="bubble">
          <button className={editor.isActive("bold") ? "on" : ""} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button>
          <button className={editor.isActive("italic") ? "on" : ""} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button>
          <button className={editor.isActive("strike") ? "on" : ""} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></button>
          <button className={editor.isActive("code") ? "on" : ""} onClick={() => editor.chain().focus().toggleCode().run()}>{"</>"}</button>
          <button className={editor.isActive("link") ? "on" : ""} onClick={setLink}>Link</button>
        </BubbleMenu>
      )}
      </div>
      <EditorContent editor={editor} />
      {slash && items.length > 0 && (
        <div className="slash" style={{ left: slash.x, top: slash.y }} role="listbox">
          {items.map((it, i) => (
            <div
              key={it.title}
              role="option"
              aria-selected={i === sel}
              className={i === sel ? "sel" : ""}
              onMouseDown={(e) => { e.preventDefault(); runSlash(it); }}
              onMouseEnter={() => setSel(i)}
            >
              {it.title}<small>{it.hint}</small>
            </div>
          ))}
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f && editor) void insertFiles(editor, [f]);
        }}
      />
    </div>
  );
}
