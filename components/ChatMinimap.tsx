"use client";

import { memo, useEffect, useRef, useState, useCallback, useMemo, type CSSProperties, type RefObject } from "react";
import ReactMarkdown, { type Options as ReactMarkdownOptions } from "react-markdown";
import rehypeKatex from "rehype-katex";
import {
  markdownPreviewRemarkPlugins,
  normalizeDisplayMath,
} from "@/lib/markdown";
import { isMessageGroupAnchor, splitFinalAssistantBlocks } from "@/lib/message-display";
import { loadMinimapPreviewLocked, saveMinimapPreviewLocked } from "@/lib/minimap-preview-lock";
import type { AgentMessage, AssistantMessage, CustomMessage, TextContent, UserMessage } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";
import styles from "./ChatMinimap.module.css";

interface Props {
  messages: AgentMessage[];
  /** The reply being streamed, read when the turns are measured: it never re-renders the minimap. */
  getStreamingMessage: () => Partial<AgentMessage> | null;
  scrollContainer: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
  onRevealHistory: () => void;
  /** Turns of the branch the server has not sent yet: numbers continue from it (#791). */
  turnsBefore: number;
}

const MAX_NODE_GAP = 10;
const MINIMAP_PADDING = 28;
// Reserve space below the centered tick group for its preview-lock control.
const MINIMAP_BOTTOM_PADDING = 36 + MINIMAP_PADDING;
const PREVIEW_HIDE_DELAY = 250;
const NAVIGATION_ACTIVE_LOCK_MS = 1600;

interface AssistantPreview {
  markdown: string;
  element: HTMLDivElement | null;
}

interface TurnInfo {
  userMessage: UserMessage | CustomMessage;
  assistantPreviews: AssistantPreview[];
  scrollTop: number | null;
  /** Tool calls issued anywhere in this turn's assistant replies. */
  toolCount: number;
}

interface NodeInfo {
  topRatio: number;
  targetTurn: TurnInfo;
  index: number;
}

function getUserPreview(message: UserMessage | CustomMessage): string {
  if (typeof message.content === "string") return message.content.trim();
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** Tool calls in one assistant message. A reply can both answer and call
 *  tools, so this counts blocks rather than text-less messages. */
export function countToolCalls(message: AgentMessage | Partial<AgentMessage>): number {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return 0;
  return message.content.reduce(
    (total, block) => total + (block.type === "toolCall" ? 1 : 0),
    0,
  );
}

function getAssistantAnswerMarkdown(message: AgentMessage | Partial<AgentMessage>): string {
  if (message.role !== "assistant") return "";
  const { answerBlocks } = splitFinalAssistantBlocks(message as AssistantMessage);
  return answerBlocks
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

function PreviewHeading({
  level,
  children,
  headingIndex,
  onClick,
}: {
  level: 1 | 2 | 3;
  children: React.ReactNode;
  headingIndex: number | null;
  onClick?: (headingIndex: number) => void;
}) {
  return (
    <button
      type="button"
      className={styles.heading}
      data-level={level}
      data-preview-heading-index={headingIndex ?? undefined}
      disabled={headingIndex === null || !onClick}
      onClick={(event) => {
        event.stopPropagation();
        if (headingIndex !== null) onClick?.(headingIndex);
      }}
    >
      {children}
    </button>
  );
}

interface PreviewAstNode {
  type?: string;
  depth?: number;
  data?: {
    hProperties?: Record<string, unknown>;
  };
}

function remarkPreviewOutline() {
  return (tree: { children?: PreviewAstNode[] }) => {
    if (!Array.isArray(tree.children)) return;
    const headings = tree.children.filter((node) => (
      node.type === "heading" && typeof node.depth === "number" && node.depth <= 3
    ));
    if (headings.length > 0) {
      headings.forEach((node, headingIndex) => {
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            "data-preview-heading-index": headingIndex,
          },
        };
      });
      tree.children = headings;
      return;
    }
    tree.children = tree.children.filter((node) => node.type === "paragraph" || node.type === "list").slice(0, 2);
  };
}

const previewRemarkPlugins = [
  ...(markdownPreviewRemarkPlugins ?? []),
  remarkPreviewOutline,
];
const previewRehypePlugins: ReactMarkdownOptions["rehypePlugins"] = [
  [rehypeKatex, { throwOnError: false, strict: false }],
];

function getPreviewHeadingIndex(node: unknown): number | null {
  const properties = (node as { properties?: Record<string, unknown> } | undefined)?.properties;
  const value = properties?.dataPreviewHeadingIndex ?? properties?.["data-preview-heading-index"];
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

export const AssistantOutline = memo(function AssistantOutline({
  markdown,
  onHeadingClick,
  onAnswerClick,
}: {
  markdown: string;
  onHeadingClick?: (headingIndex: number) => void;
  onAnswerClick?: () => void;
}) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(markdown), [markdown]);
  if (!markdown) return null;
  return (
    <div className={styles.outline}>
      <ReactMarkdown
        remarkPlugins={previewRemarkPlugins}
        rehypePlugins={previewRehypePlugins}
        components={{
          h1: ({ children, node }) => <PreviewHeading level={1} headingIndex={getPreviewHeadingIndex(node)} onClick={onHeadingClick}>{children}</PreviewHeading>,
          h2: ({ children, node }) => <PreviewHeading level={2} headingIndex={getPreviewHeadingIndex(node)} onClick={onHeadingClick}>{children}</PreviewHeading>,
          h3: ({ children, node }) => <PreviewHeading level={3} headingIndex={getPreviewHeadingIndex(node)} onClick={onHeadingClick}>{children}</PreviewHeading>,
          h4: () => null,
          h5: () => null,
          h6: () => null,
          p: ({ children }) => (
            <button
              type="button"
              className={styles.paragraph}
              onClick={onAnswerClick}
            >
              {children}
            </button>
          ),
          blockquote: () => null,
          ul: ({ children }) => <ul className={styles.list}>{children}</ul>,
          ol: ({ children }) => <ol className={styles.list}>{children}</ol>,
          pre: () => null,
          table: () => null,
          hr: () => null,
          a: ({ children }) => <>{children}</>,
          code: ({ children }) => <>{children}</>,
        }}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
});

function createTurnNodes(turns: TurnInfo[]): NodeInfo[] {
  return turns.map((turn, index) => ({
    topRatio: 0,
    targetTurn: turn,
    index,
  }));
}

interface NodeLayout {
  nodes: NodeInfo[];
  gap: number;
  fillsHeight: boolean;
}

function layoutNodes(allNodes: NodeInfo[], minimapHeight: number): NodeLayout {
  if (allNodes.length === 0) {
    return { nodes: [], gap: MAX_NODE_GAP, fillsHeight: false };
  }

  const height = Math.max(1, minimapHeight);
  const usableHeight = Math.min(180, Math.max(0, height - MINIMAP_PADDING - MINIMAP_BOTTOM_PADDING));
  if (allNodes.length === 1) {
    return {
      nodes: [{ ...allNodes[0], topRatio: Math.max(MINIMAP_PADDING, (height - 36) / 2) / height }],
      gap: MAX_NODE_GAP,
      fillsHeight: false,
    };
  }

  const naturalGap = usableHeight / (allNodes.length - 1);
  const gap = Math.min(MAX_NODE_GAP, naturalGap);
  const start = Math.max(MINIMAP_PADDING, (height - 36 - gap * (allNodes.length - 1)) / 2);
  return {
    nodes: allNodes.map((node, index) => ({
      ...node,
      topRatio: (start + index * gap) / height,
    })),
    gap,
    fillsHeight: naturalGap <= MAX_NODE_GAP,
  };
}

export const ChatMinimap = memo(function ChatMinimap({
  messages,
  getStreamingMessage,
  scrollContainer,
  messageRefs,
  onRevealHistory,
  turnsBefore,
}: Props) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [allNodes, setAllNodes] = useState<NodeInfo[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [minimapHeight, setMinimapHeight] = useState(600);
  const [minimapHovered, setMinimapHovered] = useState(false);
  const [locked, setLocked] = useState(loadMinimapPreviewLocked);
  const [mouseYRatio, setMouseYRatio] = useState<number | null>(null);
  const [previewHeight, setPreviewHeight] = useState(180);
  const draggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const allNodesRef = useRef<NodeInfo[]>([]);
  const nodeLayoutRef = useRef<NodeLayout>({
    nodes: [],
    gap: MAX_NODE_GAP,
    fillsHeight: false,
  });
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const previewHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeNodeLockRef = useRef<{ index: number; until: number } | null>(null);
  const pendingNavigationRef = useRef<{
    nodeIndex: number;
    target: "user" | "assistant" | "heading";
    assistantIndex?: number;
    headingIndex?: number;
  } | null>(null);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const nodeLayout = useMemo(
    () => layoutNodes(allNodes, minimapHeight),
    [allNodes, minimapHeight],
  );
  const { nodes: positionedNodes, gap: nodeGap } = nodeLayout;
  nodeLayoutRef.current = nodeLayout;

  const lockActiveNode = useCallback((index: number) => {
    activeNodeLockRef.current = {
      index,
      until: Date.now() + NAVIGATION_ACTIVE_LOCK_MS,
    };
    setActiveIndex(index);
  }, []);

  const syncActiveNode = useCallback((scrollEl: HTMLDivElement, nextNodes: NodeInfo[]) => {
    const activeLock = activeNodeLockRef.current;
    if (activeLock && Date.now() < activeLock.until) {
      setActiveIndex(activeLock.index);
      return;
    }
    activeNodeLockRef.current = null;

    const measuredNodes = nextNodes.filter((node) => node.targetTurn.scrollTop !== null);
    if (measuredNodes.length === 0) {
      setActiveIndex(null);
      return;
    }
    const focusTop = scrollEl.scrollTop + scrollEl.clientHeight * 0.3;
    const nextActiveNode = measuredNodes.reduce((bestNode, node) => (
      Math.abs((node.targetTurn.scrollTop ?? 0) - focusTop)
        < Math.abs((bestNode.targetTurn.scrollTop ?? 0) - focusTop)
        ? node
        : bestNode
    ), measuredNodes[0]);
    setActiveIndex(nextActiveNode.index);
  }, []);

  const updateScroll = useCallback(() => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const scrollable = scrollEl.scrollHeight - scrollEl.clientHeight;
    const currentNodes = allNodesRef.current;
    setVisible(scrollable > 20);
    syncActiveNode(scrollEl, currentNodes);
  }, [scrollContainer, syncActiveNode]);

  const measureThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureNodes = useCallback(() => {
    if (measureThrottleRef.current) return;
    measureThrottleRef.current = setTimeout(() => {
      measureThrottleRef.current = null;
      const scrollEl = scrollContainer.current;
      const minimapEl = containerRef.current;
      if (!scrollEl || !minimapEl) return;

      const refs = messageRefs.current;
      const containerRect = scrollEl.getBoundingClientRect();
      const turns: TurnInfo[] = [];
      let refIndex = 0;
      let currentTurn: TurnInfo | null = null;

      const streamingMessage = getStreamingMessage();
      const allMessages: (AgentMessage | Partial<AgentMessage>)[] = streamingMessage
        ? [...messagesRef.current, streamingMessage]
        : messagesRef.current;
      for (const message of allMessages) {
        const isAnchor = isMessageGroupAnchor(message);
        if (!isAnchor && message.role !== "assistant") continue;
        const element = refs?.[refIndex];
        refIndex++;

        if (isAnchor) {
          currentTurn = null;
          const elementRect = element?.getBoundingClientRect();
          currentTurn = {
            userMessage: message as UserMessage | CustomMessage,
            assistantPreviews: [],
            scrollTop: elementRect
              ? elementRect.top - containerRect.top + scrollEl.scrollTop
              : null,
            toolCount: 0,
          };
          turns.push(currentTurn);
          continue;
        }

        if (!currentTurn) continue;
        currentTurn.toolCount += countToolCalls(message);
        const answerMarkdown = getAssistantAnswerMarkdown(message);
        if (answerMarkdown) {
          currentTurn.assistantPreviews.push({
            markdown: answerMarkdown,
            element,
          });
        }
      }

      const nextNodes = createTurnNodes(turns);
      setMinimapHeight(minimapEl.clientHeight);
      allNodesRef.current = nextNodes;
      setAllNodes(nextNodes);
      setVisible(scrollEl.scrollHeight - scrollEl.clientHeight > 20);
      syncActiveNode(scrollEl, nextNodes);

      const pendingNavigation = pendingNavigationRef.current;
      const pendingNode = pendingNavigation
        ? nextNodes[pendingNavigation.nodeIndex]
        : null;
      if (pendingNavigation && pendingNode) {
        const assistant = pendingNavigation.assistantIndex === undefined
          ? null
          : pendingNode.targetTurn.assistantPreviews[pendingNavigation.assistantIndex];
        let targetTop: number | null = pendingNode.targetTurn.scrollTop;
        if (pendingNavigation.target === "assistant") {
          const assistantRect = assistant?.element?.getBoundingClientRect();
          targetTop = assistantRect
            ? assistantRect.top - containerRect.top + scrollEl.scrollTop
            : null;
        } else if (pendingNavigation.target === "heading") {
          const heading = (
            pendingNavigation.headingIndex === undefined
              ? null
              : assistant?.element
                ?.querySelectorAll<HTMLElement>("h1, h2, h3")
                .item(pendingNavigation.headingIndex)
          );
          const headingRect = heading?.getBoundingClientRect();
          targetTop = headingRect
            ? headingRect.top - containerRect.top + scrollEl.scrollTop
            : null;
        }
        if (targetTop === null) return;
        pendingNavigationRef.current = null;
        lockActiveNode(pendingNode.index);
        const targetOffset = scrollEl.clientHeight * 0.3;
        scrollEl.scrollTo({ top: Math.max(0, targetTop - targetOffset), behavior: "smooth" });
      }
    }, 150);
  }, [getStreamingMessage, lockActiveNode, messageRefs, scrollContainer, syncActiveNode]);

  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    el.addEventListener("scroll", updateScroll, { passive: true });
    return () => el.removeEventListener("scroll", updateScroll);
  }, [scrollContainer, updateScroll]);

  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    const syncLayout = () => {
      measureNodes();
      updateScroll();
    };
    const ro = new ResizeObserver(syncLayout);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    syncLayout();
    return () => {
      ro.disconnect();
      if (measureThrottleRef.current) {
        clearTimeout(measureThrottleRef.current);
        measureThrottleRef.current = null;
      }
    };
  }, [measureNodes, scrollContainer, updateScroll]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      measureNodes();
      updateScroll();
    }, 50);
    return () => clearTimeout(timeout);
  }, [messages.length, measureNodes, updateScroll]);

  const scrollToNode = useCallback((node: NodeInfo, behavior: ScrollBehavior) => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    lockActiveNode(node.index);
    if (node.targetTurn.scrollTop === null) {
      pendingNavigationRef.current = { nodeIndex: node.index, target: "user" };
      onRevealHistory();
      return;
    }
    const targetTop = Math.max(
      0,
      node.targetTurn.scrollTop - scrollEl.clientHeight * 0.3,
    );
    scrollEl.scrollTo({ top: targetTop, behavior });
  }, [lockActiveNode, onRevealHistory, scrollContainer]);

  const scrollToAssistant = useCallback((node: NodeInfo, assistantIndex: number) => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const assistantElement = node.targetTurn.assistantPreviews[assistantIndex]?.element;
    if (!assistantElement) {
      pendingNavigationRef.current = {
        nodeIndex: node.index,
        target: "assistant",
        assistantIndex,
      };
      onRevealHistory();
      return;
    }
    const containerRect = scrollEl.getBoundingClientRect();
    const assistantRect = assistantElement.getBoundingClientRect();
    const targetTop = (
      assistantRect.top
      - containerRect.top
      + scrollEl.scrollTop
      - scrollEl.clientHeight * 0.3
    );
    lockActiveNode(node.index);
    scrollEl.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
  }, [lockActiveNode, onRevealHistory, scrollContainer]);

  const findNearestNode = useCallback((ratio: number): NodeInfo | null => {
    const { nodes, gap } = nodeLayoutRef.current;
    const height = containerRef.current?.clientHeight ?? 0;
    if (nodes.length === 0 || height <= 0) return null;

    const pointerY = Math.max(0, Math.min(height, ratio * height));
    const firstNodeY = nodes[0].topRatio * height;
    const rawIndex = gap > 0 ? Math.round((pointerY - firstNodeY) / gap) : 0;
    const nodeIndex = Math.max(0, Math.min(nodes.length - 1, rawIndex));
    const nearestNode = nodes[nodeIndex];

    const nodeY = nearestNode.topRatio * height;
    const hitRadius = Math.max(10, gap / 2);
    if (Math.abs(pointerY - nodeY) > hitRadius) return null;
    return nearestNode;
  }, []);

  const scrollToHeading = useCallback((
    node: NodeInfo,
    assistantIndex: number,
    headingIndex: number,
  ) => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const answerElement = node.targetTurn.assistantPreviews[assistantIndex]?.element;
    if (!answerElement) {
      pendingNavigationRef.current = {
        nodeIndex: node.index,
        target: "heading",
        assistantIndex,
        headingIndex,
      };
      onRevealHistory();
      return;
    }
    const heading = answerElement.querySelectorAll<HTMLElement>("h1, h2, h3").item(headingIndex);
    if (!heading) return;
    const containerRect = scrollEl.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const targetTop = (
      headingRect.top
      - containerRect.top
      + scrollEl.scrollTop
      - scrollEl.clientHeight * 0.3
    );
    lockActiveNode(node.index);
    scrollEl.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
  }, [lockActiveNode, onRevealHistory, scrollContainer]);

  const cancelPreviewHide = useCallback(() => {
    if (!previewHideTimerRef.current) return;
    clearTimeout(previewHideTimerRef.current);
    previewHideTimerRef.current = null;
  }, []);

  const showPreview = useCallback(() => {
    if (locked) return;
    cancelPreviewHide();
    setMinimapHovered(true);
  }, [cancelPreviewHide, locked]);

  const toggleLock = useCallback(() => {
    const next = !locked;
    setLocked(next);
    saveMinimapPreviewLocked(next);
    if (next) {
      cancelPreviewHide();
      setMinimapHovered(false);
      setMouseYRatio(null);
    }
  }, [cancelPreviewHide, locked]);

  const schedulePreviewHide = useCallback(() => {
    cancelPreviewHide();
    previewHideTimerRef.current = setTimeout(() => {
      previewHideTimerRef.current = null;
      setMinimapHovered(false);
      setMouseYRatio(null);
    }, PREVIEW_HIDE_DELAY);
  }, [cancelPreviewHide]);

  useEffect(() => () => cancelPreviewHide(), [cancelPreviewHide]);

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!visible) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerRatio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    if (!findNearestNode(pointerRatio)) return;
    draggingRef.current = true;
    showPreview();
    setMouseYRatio(pointerRatio);
    const jumpToPointer = (clientY: number, behavior: ScrollBehavior) => {
      const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      const node = findNearestNode(ratio);
      if (node) {
        scrollToNode(node, behavior);
      }
    };

    jumpToPointer(event.clientY, "smooth");
    const onMove = (moveEvent: MouseEvent) => {
      if (!draggingRef.current) return;
      jumpToPointer(moveEvent.clientY, "auto");
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [findNearestNode, scrollToNode, showPreview, visible]);

  const nearestNode = mouseYRatio === null ? null : findNearestNode(mouseYRatio);
  const nearestNodeIndex = nearestNode?.index ?? null;
  const previewNode = nearestNode ?? positionedNodes[activeIndex ?? 0];
  const previewTop = Math.max(8, Math.min(
    (previewNode?.topRatio ?? .5) * minimapHeight - previewHeight / 2,
    minimapHeight - previewHeight - 8,
  ));

  useEffect(() => {
    if (!minimapHovered) return;
    const previewBox = previewBoxRef.current;
    if (!previewBox) return;
    previewBox.scrollTop = 0;
    const observer = new ResizeObserver(() => setPreviewHeight(previewBox.offsetHeight));
    observer.observe(previewBox);
    return () => observer.disconnect();
  }, [allNodes, minimapHovered, nearestNodeIndex]);

  if (!visible) return null;

  return (
    <div
      ref={containerRef}
      className={styles.rail}
      role="navigation"
      aria-label={t("chatMinimap.title")}
      data-chat-minimap=""
      onMouseDown={handleMouseDown}
      onMouseLeave={schedulePreviewHide}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) schedulePreviewHide();
      }}
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = (event.clientY - rect.top) / rect.height;
        setMouseYRatio(ratio);
        if (findNearestNode(ratio)) showPreview();
        else schedulePreviewHide();
      }}
    >
      {turnsBefore > 0 && (
        <div
          data-minimap-earlier=""
          style={{
            position: "absolute",
            left: "50%",
            top: Math.max(0, (positionedNodes[0]?.topRatio ?? 0) * minimapHeight - MINIMAP_PADDING),
            height: MINIMAP_PADDING - 8,
            width: 1,
            background: "repeating-linear-gradient(to bottom, var(--text-dim) 0 2px, transparent 2px 4px)",
            transform: "translateX(-50%)",
            zIndex: 0,
          }}
        />
      )}
      {positionedNodes.map((node) => {
        const isNearest = minimapHovered && nearestNode?.index === node.index;
        const isActive = activeIndex === node.index;
        const distance = mouseYRatio === null ? Infinity : Math.abs(node.topRatio - mouseYRatio) * minimapHeight;
        const hoverWidth = 6 + 22 * Math.exp(-(distance * distance) / 400);

        return (
          <button
            type="button"
            key={node.index}
            className={styles.node}
            data-minimap-node-index={node.index}
            data-minimap-node-active={isActive ? "" : undefined}
            data-nearest={isNearest ? "true" : undefined}
            aria-label={t("chatMinimap.turn", { count: turnsBefore + node.index + 1 })}
            aria-current={isActive ? "step" : undefined}
            onFocus={() => { setMouseYRatio(node.topRatio); showPreview(); }}
            onClick={(event) => {
              // Pointer navigation (including dragging) is handled by the rail.
              if (event.detail === 0) scrollToNode(node, "smooth");
            }}
            style={{
              top: `${node.topRatio * 100}%`,
              height: Math.max(1, Math.min(32, nodeGap)),
            }}
          >
            <span className={styles.marker} style={{ "--tick-width": `${hoverWidth}px` } as CSSProperties} aria-hidden="true" />
          </button>
        );
      })}

      <button
        type="button"
        className={styles.lock}
        style={{ top: Math.min(minimapHeight - 32, (positionedNodes.at(-1)?.topRatio ?? .5) * minimapHeight + 16) }}
        data-minimap-lock={locked ? "on" : "off"}
        aria-pressed={locked}
        title={t(locked ? "chatMinimap.unlockPreview" : "chatMinimap.lockPreview")}
        aria-label={t(locked ? "chatMinimap.unlockPreview" : "chatMinimap.lockPreview")}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          toggleLock();
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="4" y="11" width="16" height="10" rx="2" />
          {locked ? (
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          ) : (
            <path d="M8 11V7a4 4 0 0 1 7.9-.9" />
          )}
        </svg>
      </button>

      {minimapHovered && previewNode && (
        <div
          ref={previewBoxRef}
          className={styles.preview}
          data-minimap-preview-box=""
          style={{ top: `clamp(8px, ${previewTop}px, max(8px, calc(100% - ${previewHeight}px - 8px)))` }}
          aria-label={t("chatMinimap.turn", { count: turnsBefore + previewNode.index + 1 })}
          onMouseEnter={showPreview}
          onMouseDown={(event) => event.stopPropagation()}
          onMouseMove={(event) => event.stopPropagation()}
        >
          {turnsBefore > 0 && (
            <button
              type="button"
              className={styles.earlier}
              data-minimap-preview-earlier=""
              // The chat's top sentinel pages the older history in.
              onClick={() => scrollContainer.current?.scrollTo({ top: 0, behavior: "smooth" })}
            >
              {t("chatMinimap.earlierTurns", { count: turnsBefore })}
            </button>
          )}
          {[previewNode].map((node) => {
            const isLocated = nearestNodeIndex === node.index;
            return (
              <div
                key={node.index}
                className={styles.turn}
                data-minimap-preview-index={node.index}
                data-located={isLocated ? "true" : undefined}
                data-active={activeIndex === node.index ? "true" : undefined}
              >
                <span className={styles.number}>
                  <span aria-hidden="true">
                    {String(turnsBefore + node.index + 1).padStart(2, "0")}
                  </span>
                  {node.targetTurn.toolCount > 0 && (
                    <span
                      className={styles.toolBadge}
                      role="img"
                      title={t("chatMinimap.toolCalls", { count: node.targetTurn.toolCount })}
                      aria-label={t("chatMinimap.toolCalls", { count: node.targetTurn.toolCount })}
                    >
                      {node.targetTurn.toolCount > 99 ? "99+" : node.targetTurn.toolCount}
                    </span>
                  )}
                </span>
                <div className={styles.content}>
                  <button
                    type="button"
                    className={styles.user}
                    data-minimap-preview-user={node.index}
                    onClick={() => {
                      scrollToNode(node, "smooth");
                    }}
                  >
                    <span className={styles.userText}>
                      {getUserPreview(node.targetTurn.userMessage)}
                    </span>
                  </button>

                  {node.targetTurn.assistantPreviews.map((assistant, assistantIndex) => (
                    <div
                      key={assistantIndex}
                      className={styles.assistant}
                    >
                      <button
                        type="button"
                        className={styles.assistantJump}
                        data-minimap-preview-assistant={`${node.index}-${assistantIndex}`}
                        onClick={() => scrollToAssistant(node, assistantIndex)}
                        aria-label={t("chatMinimap.locateAssistant")}
                        title={t("chatMinimap.locateAssistant")}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M5 4v9a4 4 0 0 0 4 4h10m-4-4 4 4-4 4" />
                        </svg>
                      </button>
                      <AssistantOutline
                        markdown={assistant.markdown}
                        onAnswerClick={() => scrollToAssistant(node, assistantIndex)}
                        onHeadingClick={(headingIndex) => (
                          scrollToHeading(node, assistantIndex, headingIndex)
                        )}
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

// Hook to create a stable array of refs for messages
export function useMessageRefs(count: number): RefObject<(HTMLDivElement | null)[]> {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  refs.current = Array(count).fill(null).map((_, i) => refs.current[i] ?? null);
  return refs;
}
