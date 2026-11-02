"use client";

import type { ReactNode, Ref } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AgentsIcon } from "./SidebarIcons";
import { PetWidget } from "./PetWidget";
import { AppUpdateButton } from "./AppUpdateButton";

export type WorkspacePanel = "archive" | "history" | "system" | "tools" | "agents" | "branches" | "session" | "debug";
export type WorkspaceView = "home" | "chat" | "settings" | WorkspacePanel;

export const WORKSPACE_VIEW_LABELS: Record<WorkspaceView, string> = {
  home: "navigation.home", chat: "navigation.chat", settings: "common.settings", archive: "sidebar.archived",
  history: "history.full", system: "system.prompt", tools: "tools.title",
  agents: "agentSwitcher.title", branches: "i18n.branches", session: "session.title", debug: "debug.title",
};

function ViewIcon({ view }: { view: WorkspaceView }) {
  if (view === "agents") return <AgentsIcon size={20} strokeWidth={1.7} />;
  let shape: ReactNode;
  switch (view) {
    case "home":
      shape = <><path d="m3.5 10 8.5-7 8.5 7v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" /><path d="M9 20.5v-6h6v6" /></>;
      break;
    case "chat":
      shape = <path d="M5 4.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 3v-14a2 2 0 0 1 1-2Z" />;
      break;
    case "history":
      shape = <><path d="M4 8a8.5 8.5 0 1 1-1 4" /><path d="M4 3.5V8h4.5M12 7.5v5l3.5 2" /></>;
      break;
    case "system":
      shape = <><path d="M6 3.5h8l4 4v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" /><path d="M14 3.5v4h4M8 11l2 2-2 2m4 0h3" /></>;
      break;
    case "tools":
      shape = <><rect x="3.5" y="7.5" width="17" height="13" rx="2" /><path d="M9 7.5v-2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3.5 13h17M10.5 13v1.5h3V13" /></>;
      break;
    case "branches":
      shape = <><path d="M14.5 7V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2v2l2.5-2" /><path d="M11 9h8a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2v2.5L16.5 18H11a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z" /><path d="M12 13.5h5.5" /></>;
      break;
    case "settings":
      shape = <><path d="M4 7h10M18 7h2M4 17h2m4 0h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></>;
      break;
    default:
      return null;
  }
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shape}</svg>;
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
