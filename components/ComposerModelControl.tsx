"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { ModelSelector, type ModelSelectorOption } from "./ModelSelector";

const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ExplicitLevel = typeof LEVELS[number];
export type ComposerThinkingLevel = "auto" | ExplicitLevel;
type ModelValue = { provider: string; modelId: string };

export function getReasoningSteps(available?: string[] | null, mapping?: Record<string, string | null> | null): ExplicitLevel[] {
  return LEVELS.filter(level => level !== "off" && (!available || available.includes(level)) && mapping?.[level] !== null);
}

interface Props {
  options: ModelSelectorOption[];
  model?: ModelValue | null;
  isAutoModelSelection?: boolean;
  onModelChange?: (provider: string, modelId: string) => void;
  defaultModel?: ModelValue | null;
  onSetDefaultModel?: (provider: string, modelId: string) => void;
  isStreaming: boolean;
  modelSwitching?: boolean;
  thinkingLevel?: ComposerThinkingLevel;
  isAutoThinkingSelection?: boolean;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  onThinkingLevelChange?: (level: ComposerThinkingLevel) => void;
  savedDefaultThinkingLevel?: string | null;
  onSetDefaultThinkingLevel?: (level: ExplicitLevel) => void;
}

export function ComposerModelControl({ options, model, isAutoModelSelection, onModelChange,
  defaultModel, onSetDefaultModel, isStreaming, modelSwitching, thinkingLevel,
  isAutoThinkingSelection, availableThinkingLevels, thinkingLevelMap, onThinkingLevelChange,
  savedDefaultThinkingLevel, onSetDefaultThinkingLevel }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const wasSwitchingRef = useRef(Boolean(modelSwitching));
  const id = useId();
  const steps = getReasoningSteps(availableThinkingLevels, thinkingLevelMap);
  const explicit = thinkingLevel && thinkingLevel !== "auto" ? thinkingLevel : null;
  const automatic = isAutoThinkingSelection || thinkingLevel === "auto" || !thinkingLevel;
  const label = (level: ComposerThinkingLevel) => {
    const mapped = level !== "auto" ? thinkingLevelMap?.[level] : null;
    return mapped != null && mapped !== level ? mapped : t(`chat.reasoningShort.${level}`);
  };
  const reasoningLabel = label(explicit ?? "auto");
  const modelName = model ? options.find(item => item.provider === model.provider && item.modelId === model.modelId)?.name ?? model.modelId
    : options.length ? t("chat.selectModel") : t("chat.noModels");
  const selectedIndex = explicit ? steps.indexOf(explicit) : -1;
  const sliderIndex = Math.max(0, selectedIndex);
  const canChangeReasoning = Boolean(onThinkingLevelChange) && !modelSwitching;
  const offAvailable = !availableThinkingLevels || availableThinkingLevels.includes("off");
  const locked = Boolean(modelSwitching || (isStreaming && !onThinkingLevelChange));
  const close = useCallback((restore = false) => {
    setOpen(false);
    if (restore) triggerRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const wasSwitching = wasSwitchingRef.current;
    wasSwitchingRef.current = Boolean(modelSwitching);
    if (open && wasSwitching && !modelSwitching && document.activeElement === document.body) {
      modelRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    }
  }, [open, modelSwitching]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !panelRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, close]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const rect = trigger.getBoundingClientRect();
      const cardWidth = Math.min(332, width - 16);
      const cardHeight = Math.min(panel.getBoundingClientRect().height, height - 16);
      const above = rect.top - top - 8;
      const below = top + height - rect.bottom - 8;
      const desiredTop = above >= cardHeight || above >= below ? rect.top - cardHeight - 8 : rect.bottom + 8;
      const next = { left: Math.max(left + 8, Math.min(rect.left, left + width - cardWidth - 8)),
        top: Math.max(top + 8, Math.min(desiredTop, top + height - cardHeight - 8)),
        width: cardWidth, maxHeight: Math.max(0, height - 16) };
      setPosition(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    update();
    const resize = new ResizeObserver(update);
    if (panelRef.current) resize.observe(panelRef.current);
    const root = new MutationObserver(update);
    root.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-keyboard-open"] });
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    const focusFrame = requestAnimationFrame(() => {
      (sliderRef.current ?? panelRef.current?.querySelector<HTMLElement>("button:not(:disabled)") ?? panelRef.current)?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(focusFrame);
      resize.disconnect(); root.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [open]);

  const chooseLevel = (level: ComposerThinkingLevel) => {
    if (!canChangeReasoning) return;
    if (level === "auto" ? !automatic : automatic || level !== explicit) onThinkingLevelChange?.(level);
  };
  const focusModel = () => modelRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  const isSavedDefault = explicit === savedDefaultThinkingLevel;
  return <div className="model-reasoning-root">
    <button ref={triggerRef} type="button" className="model-reasoning-trigger composer-model-trigger"
      aria-label={t("chat.modelReasoning")} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      aria-busy={modelSwitching || undefined} disabled={locked}
      title={modelSwitching ? "Switching model" : !options.length && !model ? "No available models"
        : `${modelName}${onThinkingLevelChange ? ` · ${reasoningLabel}` : ""}`}
      onClick={() => { setPosition(null); setOpen(value => !value); }}>
      {modelSwitching && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 0.8s linear infinite" }} aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36" /></svg>}
      <span className="model-reasoning-name">{modelName}</span>
      {onThinkingLevelChange && <><span aria-hidden="true">·</span><span className="model-reasoning-level">{reasoningLabel}</span></>}
      <span className="chat-composer-caret" aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={panelRef} id={id} role="dialog" aria-label={t("chat.modelReasoning")}
      tabIndex={-1} className="model-reasoning-card composer-model-card" style={{ ...position, visibility: position ? "visible" : "hidden" }}
      onKeyDown={event => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
        if (event.key === "Tab") {
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')]
            .filter(element => element.getClientRects().length > 0);
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <div className="model-reasoning-heading">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z" /></svg>
        <strong>{onThinkingLevelChange ? reasoningLabel : t("chat.selectModel")}</strong>
        {onThinkingLevelChange && <button type="button" className="model-reasoning-reset" aria-label={t("chat.resetReasoning")}
          title={t("chat.resetReasoning")} disabled={!canChangeReasoning || automatic} onClick={() => chooseLevel("auto")}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10a9 9 0 1 1 2.5 8M3 4v6h6" /></svg>
        </button>}
      </div>
      {onModelChange && <div ref={modelRef} className="model-reasoning-model">
        <ModelSelector options={options} value={model} variant="field" placement="auto" ariaLabel={t("chat.selectModel")}
          isAutoSelection={isAutoModelSelection} disabled={isStreaming} busy={modelSwitching}
          onChange={(provider, modelId) => { onModelChange(provider, modelId); focusModel(); }}
          onReselect={(provider, modelId) => { onModelChange(provider, modelId); focusModel(); }}
          defaultValue={defaultModel} onSetDefault={onSetDefaultModel ? (provider, modelId) => { onSetDefaultModel(provider, modelId); focusModel(); } : undefined} />
      </div>}
      {onThinkingLevelChange && <>
        <div className="model-reasoning-modes">
          <button type="button" aria-pressed={automatic} disabled={!canChangeReasoning} onClick={() => chooseLevel("auto")}>{t("chat.reasoningShort.auto")}</button>
          {offAvailable && <button type="button" aria-pressed={!automatic && explicit === "off"} disabled={!canChangeReasoning} onClick={() => chooseLevel("off")}>{t("chat.reasoningShort.off")}</button>}
        </div>
        {steps.length > 1 ? <div className="model-reasoning-sliderGroup" data-inactive={explicit === "off"}>
          <div className="model-reasoning-track" style={{ "--reasoning-progress": `${selectedIndex < 0 ? 0 : selectedIndex / (steps.length - 1) * 100}%` } as CSSProperties}>
            <div className="model-reasoning-dots" aria-hidden="true">{steps.map(level => <span key={level} />)}</div>
            <input ref={sliderRef} type="range" min={0} max={steps.length - 1} step={1} value={sliderIndex}
              disabled={!canChangeReasoning} aria-label={t("chat.reasoningMenuTitle")}
              aria-valuetext={selectedIndex < 0 ? reasoningLabel : `${label(steps[sliderIndex])} (${steps[sliderIndex]})`}
              onClick={event => chooseLevel(steps[Number(event.currentTarget.value)])}
              onKeyDown={event => {
                // The first stop must also activate reasoning from Off/Auto:
                // a range already at zero emits no change for Home or a click.
                if ((automatic || selectedIndex < 0) && ["Home", "End"].includes(event.key)) {
                  event.preventDefault(); chooseLevel(event.key === "Home" ? steps[0] : steps[steps.length - 1]);
                } else if (selectedIndex < 0 && event.key.startsWith("Arrow")) {
                  event.preventDefault(); chooseLevel(steps[0]);
                }
              }}
              onChange={event => chooseLevel(steps[Number(event.target.value)])} />
          </div>
          <div className="model-reasoning-scale" aria-hidden="true"><span>{label(steps[0])}</span><span>{label(steps[steps.length - 1])}</span></div>
        </div> : steps.length === 1 ? <div className="model-reasoning-single"><button type="button" aria-pressed={!automatic && explicit === steps[0]} disabled={!canChangeReasoning} onClick={() => chooseLevel(steps[0])}>{label(steps[0])}</button></div>
          : <p className="model-reasoning-hint">{t("chat.reasoningUnavailable")}</p>}
        {explicit && thinkingLevelMap?.[explicit] != null && thinkingLevelMap[explicit] !== explicit && <p className="model-reasoning-hint">{thinkingLevelMap[explicit]} · {explicit}</p>}
        {isStreaming && <p className="model-reasoning-hint">{t("chat.reasoningNextRequest")}</p>}
        {onSetDefaultThinkingLevel && explicit && (explicit === "off" ? offAvailable : steps.includes(explicit)) && <button type="button" className="model-reasoning-saveDefault"
          disabled={!canChangeReasoning || isSavedDefault} onClick={() => onSetDefaultThinkingLevel(explicit)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill={isSavedDefault ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z" /></svg>
          {t(isSavedDefault ? "chat.defaultThinking" : "chat.saveDefaultThinking")}
        </button>}
      </>}
    </div>, document.body)}
  </div>;
}
