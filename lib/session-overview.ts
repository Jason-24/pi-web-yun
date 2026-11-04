import type { SessionEntry } from "./types";
import { getFileName, normalizeFilePathSlashes } from "./file-paths";
import { resolveLocalFileHref, resolveLocalFilePath } from "./file-links";
import { skillExpansionToCommand } from "./slash-display";
import { MAX_ATTACHED_IMAGE_BYTES } from "./image-attachments";
import { TOOL_RESULT_IMAGE_MIMES } from "./tool-result-images";

export type OverviewSource =
  | { kind: "file"; id: string; path: string; name: string }
  | { kind: "image"; id: string; entryId: string; blockIndex: number; number: number };
export interface OverviewSources { sources: OverviewSource[]; total: number }
export const OVERVIEW_SOURCE_LIMIT = 200;

export function sameOverviewDirectory(a: string, b: string): boolean {
  const normalize = (p: string) => {
    const value = normalizeFilePathSlashes(p).replace(/\/+$/, "");
    return /^[a-z]:(?:\/|$)/i.test(value) || value.startsWith("//") ? value.toLowerCase() : value;
  };
  return normalize(a) === normalize(b);
}

export function readOverviewImage(block: unknown): { data: string; mime: string } | null {
  if (!block || typeof block !== "object") return null;
  const value = block as { type?: string; data?: unknown; mimeType?: unknown; source?: { type?: string; data?: unknown; media_type?: unknown } };
  if (value.type !== "image") return null;
  const data = value.data ?? (value.source?.type === "base64" ? value.source.data : null);
  const mime = value.mimeType ?? value.source?.media_type;
  if (typeof data !== "string" || !data.length || typeof mime !== "string" || !TOOL_RESULT_IMAGE_MIMES.has(mime)
    || data.length > Math.ceil(MAX_ATTACHED_IMAGE_BYTES * 4 / 3) + 4) return null;
  return { data, mime };
}

/** Only user-provided images and explicit file references, from one branch. No tool output or remote URLs. */
export function collectOverviewSources(entries: readonly SessionEntry[], cwd: string): OverviewSources {
  const sources = new Map<string, OverviewSource>();
  let number = 0;
  const addFile = (path: string | null) => {
    if (!path || /[\u0000-\u001f]/.test(path) || /[\\/]$/.test(path)) return;
    const key = /^[a-z]:\//i.test(path) || path.startsWith("//") ? path.toLowerCase() : path;
    const id = `file:${key}`;
    sources.delete(id);
    sources.set(id, { kind: "file", id, path, name: getFileName(path) });
  };
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "user") continue;
    const blocks = typeof entry.message.content === "string" ? [{ type: "text", text: entry.message.content }] : entry.message.content;
    for (const [blockIndex, block] of blocks.entries()) {
      if (readOverviewImage(block)) {
        number++;
        const id = `${entry.id}:${blockIndex}`;
        sources.set(id, { kind: "image", id, entryId: entry.id, blockIndex, number });
      }
      if (block.type !== "text") continue;
      // Expanded skill instructions are not sources supplied by the user.
      const text = skillExpansionToCommand(block.text) ?? block.text;
      for (const match of text.matchAll(/(?:^|\s)@(?:"([^"\r\n]+)"|([^\s"]+))/g)) {
        const mention = (match[1] ?? match[2]).replace(/:\d+(?:-\d+|:\d+)?$/, "");
        if (/[\\/]$/.test(mention) || /^[a-z][a-z0-9+.-]*:\/\//i.test(mention)) continue;
        addFile(resolveLocalFilePath(mention, cwd));
      }
      for (const match of text.matchAll(/\[[^\]\r\n]*\]\((<[^>\r\n]+>|[^\s)]+)\)/g)) {
        const href = match[1].replace(/^<|>$/g, "");
        if (href === "." || href === ".." || /[\\/]$/.test(href)) continue;
        addFile(resolveLocalFileHref(href, cwd));
      }
    }
  }
  return { sources: [...sources.values()].reverse().slice(0, OVERVIEW_SOURCE_LIMIT), total: sources.size };
}
