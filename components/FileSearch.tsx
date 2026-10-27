"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";

const MATCH_LIMIT = 5_000;

// Map text offsets back to DOM ranges, including matches split across Prism
// tokens or inline Markdown. Never rewrite React's DOM to insert <mark>s.
function findRanges(root: HTMLElement, query: string): { ranges: Range[]; limited: boolean } {
  if (!query) return { ranges: [], limited: false };
  const nodes: { node: Text; start: number; end: number }[] = [];
  let text = "";
  let lastBlock: Element | null = null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const parent = node.parentElement;
    if (!parent || parent.closest('button, script, style, svg, [aria-hidden="true"], .react-syntax-highlighter-line-number')) continue;
    // Source/diff gutters and folded-context labels are not file contents.
    if (parent.closest(".file-source-view, .file-diff-view")
      && !parent.closest(".file-source-line-content, .file-diff-line-content")) continue;
    const block = parent.closest(".file-source-line-content, .file-diff-line-content, p, li, h1, h2, h3, h4, h5, h6, pre, td, th");
    if (block !== lastBlock) text += "\n";
    lastBlock = block;
    const start = text.length;
    text += node.data;
    nodes.push({ node, start, end: text.length });
  }
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  const ranges: Range[] = [];
  let cursor = 0;
  for (const match of text.matchAll(regex)) {
    if (ranges.length === MATCH_LIMIT) return { ranges, limited: true };
    const start = match.index;
    const end = start + match[0].length;
    while (cursor < nodes.length && nodes[cursor].end <= start) cursor++;
    let endCursor = cursor;
    while (endCursor < nodes.length && nodes[endCursor].end < end) endCursor++;
    if (!nodes[cursor] || !nodes[endCursor]) continue;
    const range = document.createRange();
    range.setStart(nodes[cursor].node, start - nodes[cursor].start);
    range.setEnd(nodes[endCursor].node, end - nodes[endCursor].start);
    ranges.push(range);
  }
  return { ranges, limited: false };
}

type HighlightWindow = Window & { Highlight?: new (...ranges: Range[]) => unknown };
type HighlightCss = typeof CSS & { highlights?: Map<string, unknown> };
type Rect = { top: number; left: number; width: number; height: number; active: boolean };

interface Props {
  contentRef: RefObject<HTMLDivElement | null>;
  enabled: boolean;
  partial: boolean;
  mode: string;
  prepareSearch: () => void;
}

export function FileSearch({ contentRef, enabled, partial, mode, prepareSearch }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<{ ranges: Range[]; limited: boolean }>({ ranges: [], limited: false });
  const [index, setIndex] = useState(0);
  const [rects, setRects] = useState<Rect[]>([]);
  const [layerTop, setLayerTop] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const shell = contentRef.current?.closest<HTMLElement>(".file-viewer-shell");
  const active = open && enabled;

  const show = useCallback(() => {
    prepareSearch();
    setOpen(true);
    // Runs after the source view replaces an iframe/virtual table if needed.
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
  }, [prepareSearch]);
  const close = useCallback(() => {
    setOpen(false);
    contentRef.current?.focus({ preventScroll: true });
  }, [contentRef]);

  useEffect(() => {
    // Returning to HTML/virtual-table Preview closes Source search rather than
    // silently reporting only the few DOM nodes that happen to be mounted.
    if (mode === "embedded") setOpen(false);
  }, [mode]);

  useEffect(() => {
    if (!enabled) return;
    const keydown = (event: KeyboardEvent) => {
      const viewer = contentRef.current?.closest<HTMLElement>(".file-viewer-shell");
      if (!viewer || viewer.closest('[inert], [aria-hidden="true"]') || !viewer.getClientRects().length) return;
      if (!viewer.contains(event.target as Node)) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        show();
      } else if (open && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    // Handle Escape before the global stop-agent listener.
    document.addEventListener("keydown", keydown, true);
    return () => document.removeEventListener("keydown", keydown, true);
  }, [close, contentRef, enabled, open, show]);

  useEffect(() => {
    const content = contentRef.current;
    if (!active || !content) return;
    const scan = () => {
      setMatches(findRanges(content, query));
      setIndex(0);
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(content, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [active, contentRef, query, mode]);

  useEffect(() => {
    const content = contentRef.current;
    if (!active || !content) return;
    const range = matches.ranges[index];
    if (!range?.startContainer.isConnected) return;
    const target = range.getBoundingClientRect();
    const bounds = content.getBoundingClientRect();
    content.scrollBy({
      top: target.top < bounds.top + 70 || target.bottom > bounds.bottom
        ? target.top - bounds.top - content.clientHeight / 2 : 0,
      left: target.left < bounds.left + 48 || target.right > bounds.right
        ? target.left - bounds.left - content.clientWidth / 2 : 0,
      behavior: "instant",
    });
  }, [active, contentRef, index, matches]);

  useEffect(() => {
    const content = contentRef.current;
    if (!active || !content) return;
    const registry = (CSS as HighlightCss).highlights;
    const Highlight = (window as HighlightWindow).Highlight;
    const native = Boolean(registry && Highlight);
    if (registry && Highlight) {
      registry.set("file-find", new Highlight(...matches.ranges));
      registry.set("file-find-current", new Highlight(...matches.ranges.slice(index, index + 1)));
    }
    let frame = 0;
    const paint = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setLayerTop(content.offsetTop);
        if (native) { setRects([]); return; }
        // Safari 16.2: paint non-interactive rectangles without touching text
        // nodes or the user's selection. Clip them to the viewer viewport.
        const bounds = content.getBoundingClientRect();
        const next: Rect[] = [];
        matches.ranges.forEach((range, i) => {
          if (!range.startContainer.isConnected) return;
          const box = range.getBoundingClientRect();
          if (box.bottom < bounds.top || box.top > bounds.bottom || box.right < bounds.left || box.left > bounds.right) return;
          for (const rect of range.getClientRects()) {
            next.push({ top: rect.top - bounds.top, left: rect.left - bounds.left, width: rect.width, height: rect.height, active: i === index });
          }
        });
        setRects(next);
      });
    };
    paint();
    content.addEventListener("scroll", paint, { passive: true });
    const resize = new ResizeObserver(paint);
    resize.observe(content);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      content.removeEventListener("scroll", paint);
      registry?.delete("file-find");
      registry?.delete("file-find-current");
    };
  }, [active, contentRef, index, matches]);

  const move = (direction: number) => setIndex(current => matches.ranges.length
    ? (current + direction + matches.ranges.length) % matches.ranges.length : 0);

  return <>
    <button type="button" className="file-viewer-icon-button" onClick={show}
      title={`${t("files.find")} (Ctrl+F)`} aria-label={t("files.find")} aria-expanded={active}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
    </button>
    {active && shell && createPortal(<>
      <style>{`::highlight(file-find) { background: color-mix(in srgb, var(--accent) 20%, var(--bg)); color: var(--text); }
        ::highlight(file-find-current) { background: var(--accent); color: var(--accent-contrast); }`}</style>
      <div className="file-find-bar" role="search" aria-label={t("files.find")} style={{ top: layerTop + 8 }}>
        <div className="file-find-row">
          <input ref={inputRef} type="search" value={query} placeholder={t("files.findPlaceholder")}
            aria-label={t("files.findPlaceholder")} spellCheck={false}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault(); move(event.shiftKey ? -1 : 1);
              }
            }} />
          <span className="file-find-count" role="status" aria-live="polite">{query ? `${matches.ranges.length ? index + 1 : 0} / ${matches.ranges.length}${matches.limited ? "+" : ""}` : ""}</span>
          <button type="button" disabled={!matches.ranges.length} onClick={() => move(-1)} title={t("files.findPrevious")} aria-label={t("files.findPrevious")}>↑</button>
          <button type="button" disabled={!matches.ranges.length} onClick={() => move(1)} title={t("files.findNext")} aria-label={t("files.findNext")}>↓</button>
          <button type="button" onClick={close} title={t("files.closeFind")} aria-label={t("files.closeFind")}>×</button>
        </div>
        {(partial || mode === "diff") && <div className="file-find-scope">{t(partial ? "files.findLoadedOnly" : "files.findDiffOnly")}</div>}
      </div>
      {rects.length > 0 && <div className="file-find-highlights" aria-hidden="true" style={{ top: layerTop }}>
        {rects.map((rect, i) => <span key={i} className={rect.active ? "is-current" : ""} style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />)}
      </div>}
    </>, shell)}
  </>;
}
