"use client";

import { useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { SidebarMenu, type SidebarMenuAnchor, type SidebarMenuItem } from "./SidebarMenu";
import { ComposeIcon, FolderPlusIcon } from "./SidebarIcons";

export const BRAND_TEXT = "PI-YUN";

interface Props {
  canCreate?: boolean;
  onNewSession?: () => void;
  onOpenProject?: (opener: HTMLElement | null) => void;
  onOpenSettings?: () => void;
}

/** Desktop application menu; phones use the sidebar's Sessions/Files tabs. */
export function PiWebTitle({ canCreate = false, onNewSession, onOpenProject, onOpenSettings }: Props) {
  const { t } = useI18n();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<SidebarMenuAnchor | null>(null);
  const menuLabel = t("navigation.appMenu", { name: BRAND_TEXT });
  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ kind: "rect", rect, align: "start" });
  };
  const items: SidebarMenuItem[] = [
    { type: "item", id: "new", label: t("i18n.newSession"), icon: <ComposeIcon size={16} />, disabled: !canCreate, onSelect: () => onNewSession?.() },
    { type: "item", id: "project", label: t("sidebar.openOtherProject"), icon: <FolderPlusIcon size={16} />, onSelect: () => onOpenProject?.(triggerRef.current) },
    ...(onOpenSettings ? [
      { type: "separator" as const, id: "settings-separator" },
      { type: "item" as const, id: "settings", label: t("common.settings"), icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="var(--bg-panel)" /><circle cx="15" cy="17" r="3" fill="var(--bg-panel)" /></svg>, onSelect: onOpenSettings },
    ] : []),
  ];
  return <>
    <button ref={triggerRef} type="button" className="sidebar-brand" aria-label={menuLabel} aria-haspopup="menu" aria-expanded={Boolean(anchor)} onClick={() => {
      if (anchor) { setAnchor(null); return; }
      openMenu();
    }} onKeyDown={(event) => {
      if (event.key === "ArrowDown" && !anchor) { event.preventDefault(); openMenu(); }
    }}>
      <span className="sidebar-brand-label">{BRAND_TEXT}</span>
      <svg className="sidebar-brand-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    <SidebarMenu open={Boolean(anchor)} anchor={anchor} sheet={false} ariaLabel={menuLabel} title={BRAND_TEXT} items={items}
      cancelLabel={t("sidebar.cancel")} onClose={() => setAnchor(null)} returnFocusTo={triggerRef.current} />
  </>;
}
