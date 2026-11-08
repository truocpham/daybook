import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useEffect, useState } from "react";
import { loadBlob } from "../lib/blobs";

function useBlobUrl(sha: string): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });
  useEffect(() => {
    let alive = true;
    let url: string | null = null;
    loadBlob(sha).then((b) => {
      if (!alive) return;
      if (!b) return setState({ url: null, failed: true });
      url = URL.createObjectURL(b);
      setState({ url, failed: false });
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [sha]);
  return state;
}

function ImageView({ node, selected }: NodeViewProps) {
  const { url, failed } = useBlobUrl(node.attrs.sha);
  return (
    <NodeViewWrapper className={"img-block" + (selected ? " selected" : "")} data-drag-handle>
      {url ? <img src={url} alt={node.attrs.alt ?? ""} draggable={false} /> : <div className="img-ph">{failed ? "Image not available offline" : "Loading image…"}</div>}
    </NodeViewWrapper>
  );
}

const size = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

function FileView({ node, selected }: NodeViewProps) {
  const { name, sha, size: bytes } = node.attrs;
  const open = async () => {
    const blob = await loadBlob(sha);
    if (!blob) return alert("This file is not available offline yet.");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name || "file";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };
  return (
    <NodeViewWrapper className={"file-block" + (selected ? " selected" : "")}>
      <button type="button" onClick={open} contentEditable={false}>
        <span aria-hidden>📎</span> <b>{name || "file"}</b> <small>{size(bytes || 0)}</small>
      </button>
    </NodeViewWrapper>
  );
}

export const ImageBlock = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({ sha: { default: null }, alt: { default: "" } }),
  parseHTML: () => [{ tag: "img[data-sha]" }],
  renderHTML: ({ HTMLAttributes }) => ["img", mergeAttributes({ "data-sha": HTMLAttributes.sha, alt: HTMLAttributes.alt })],
  addNodeView: () => ReactNodeViewRenderer(ImageView),
});

export const FileBlock = Node.create({
  name: "file",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes: () => ({ sha: { default: null }, name: { default: "" }, size: { default: 0 } }),
  parseHTML: () => [{ tag: "div[data-file-sha]" }],
  renderHTML: ({ HTMLAttributes }) => ["div", mergeAttributes({ "data-file-sha": HTMLAttributes.sha }), HTMLAttributes.name || "file"],
  addNodeView: () => ReactNodeViewRenderer(FileView),
});
