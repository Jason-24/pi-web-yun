export const PANEL_LAUNCHER_ID = "panel:launcher";
export const PANEL_FILES_ID = "tool:files";
export const PANEL_CHANGES_ID = "tool:changes";
export type PanelTool = "files" | "changes" | "terminal" | "side";

export function isFileWorkspaceTab(id: string | null): boolean {
  return Boolean(id?.startsWith("file:") || id === PANEL_FILES_ID || id === PANEL_CHANGES_ID);
}

export function panelToolShortcut(event: {
  key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean;
  isComposing?: boolean; keyCode?: number; altGraph?: boolean;
}): PanelTool | null {
  if (event.isComposing || event.keyCode === 229 || event.altGraph || !(event.ctrlKey || event.metaKey)) return null;
  const key = event.key.toLowerCase();
  if (event.altKey) return key === "s" && !event.shiftKey ? "side" : null;
  if (key === "g" && event.shiftKey) return "changes";
  if (event.shiftKey) return null;
  if (key === "p") return "files";
  return key === "`" ? "terminal" : null;
}
