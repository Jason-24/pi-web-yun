"use client";

import type { Ref } from "react";
import { useI18n } from "@/hooks/useI18n";
import { HomeIcon, MessageIcon, RestoreIcon } from "./SidebarIcons";
import { SettingsSectionIcon } from "./SettingsPanel";
import { PetWidget } from "./PetWidget";
import { AppUpdateButton } from "./AppUpdateButton";

export type WorkspacePanel = "archive" | "history" | "system" | "tools" | "agents" | "branches" | "session";
export type WorkspaceView = "home" | "chat" | "settings" | WorkspacePanel;

export const WORKSPACE_VIEW_LABELS: Record<WorkspaceView, string> = {
  home: "navigation.home", chat: "navigation.chat", settings: "common.settings", archive: "sidebar.archived",
  history: "history.full", system: "system.prompt", tools: "tools.title",
  agents: "agentSwitcher.title", branches: "i18n.branches", session: "session.title",
};

function ViewIcon({ view }: { view: WorkspaceView }) {
  if (view === "home") return <HomeIcon size={18} />;
  if (view === "chat") return <MessageIcon size={18} />;
  if (view === "history") return <RestoreIcon size={18} />;
  if (view === "branches") return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2v3l3-3" />
    <path d="M11 9h8a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2v3l-3-3h-5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z" />
    <path d="M12 13h6" />
  </svg>;
  if (view === "settings" || view === "agents") return <SettingsSectionIcon section={view === "agents" ? "agents" : "general"} size={19} />;
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {view === "system" ? <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></>
      : view === "tools" ? <path d="M14.7 6.3a5 5 0 0 0-6.1 6.1L3 18a2.1 2.1 0 0 0 3 3l5.6-5.6a5 5 0 0 0 6.1-6.1L14 13l-3-3Z" />
        : <><path d="M4 10a8 8 0 0 1 16 0v3a8 8 0 0 1-16 0ZM4 10c4 0 6-2 8-4 2 2 4 4 8 4M9 16q3 2 6 0" /><path d="M9 12h.01M15 12h.01" /></>}
  </svg>;
}

interface Props {
  activeView: WorkspaceView;
  conversationAvailable: boolean;
  inspectionAvailable: boolean;
  sessionAvailable: boolean;
  mobile: boolean;
  covered?: boolean;
  homeButtonRef?: Ref<HTMLButtonElement>;
  onHomeHover?(): void;
  onHomeLeave?(): void;
  onNavigate(view: WorkspaceView): void;
}

export function WorkspaceNavigation({ activeView, conversationAvailable, inspectionAvailable, sessionAvailable, mobile, covered = false, homeButtonRef, onHomeHover, onHomeLeave, onNavigate }: Props) {
  const { t } = useI18n();
  const items: (WorkspaceView | "pet" | "update")[] = mobile ? ["home", "chat", "history", "update", "pet", "settings"]
    : ["home", "chat", "history", "system", "tools", "agents", "branches", "update", "pet", "settings"];
  return <nav className={`workbench-settings-navigation${mobile ? " is-mobile" : ""}`} aria-label={t("navigation.workspace")} inert={covered}>
    {items.map((view) => {
      if (view === "update") return <AppUpdateButton key="update" mobile={mobile} />;
      if (view === "pet") return <PetWidget key="pet" />;
      const disabled = view === "chat" ? !conversationAvailable : view === "system" || view === "tools" ? !inspectionAvailable
        : view === "history" || view === "agents" || view === "branches" ? !sessionAvailable : false;
      const label = t(WORKSPACE_VIEW_LABELS[view]);
      return <button key={view} type="button" className={`workbench-view-button${view === "home" ? " workbench-home-button" : ""}`}
        ref={view === "home" ? homeButtonRef : undefined}
        onPointerEnter={view === "home" && !mobile ? (event) => { if (event.pointerType === "mouse") onHomeHover?.(); } : undefined}
        onPointerLeave={view === "home" && !mobile ? onHomeLeave : undefined}
        data-workspace-view={view} aria-label={label} title={disabled ? `${label} · ${t("navigation.sessionRequired")}` : label}
        aria-current={activeView === view ? "page" : undefined} disabled={disabled} onClick={() => onNavigate(view)}>
        <ViewIcon view={view} /><span className="workbench-settings-label">{label}</span>
      </button>;
    })}
  </nav>;
}
