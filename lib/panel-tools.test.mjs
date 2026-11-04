import assert from "node:assert/strict";
import test from "node:test";
import { isFileWorkspaceTab, panelToolShortcut, PANEL_FILES_ID, PANEL_CHANGES_ID, PANEL_LAUNCHER_ID } from "./panel-tools.ts";

test("workspace file and utility tabs are parked together; terminals and the transient launcher are not", () => {
  for (const id of ["file:C:/project/a.ts", PANEL_FILES_ID, PANEL_CHANGES_ID]) assert.equal(isFileWorkspaceTab(id), true);
  for (const id of [null, PANEL_LAUNCHER_ID, "agent:abc", "terminal-id"]) assert.equal(isFileWorkspaceTab(id), false);
});

test("side panel shortcuts distinguish typing, IME and AltGr from the four commands", () => {
  const event = { key: "p", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
  assert.equal(panelToolShortcut(event), "files");
  assert.equal(panelToolShortcut({ ...event, ctrlKey: false, metaKey: true }), "files");
  assert.equal(panelToolShortcut({ ...event, key: "G", shiftKey: true }), "changes");
  assert.equal(panelToolShortcut({ ...event, key: "`" }), "terminal");
  assert.equal(panelToolShortcut({ ...event, key: "s", altKey: true }), "side");
  for (const override of [{ ctrlKey: false }, { isComposing: true }, { keyCode: 229 }, { altGraph: true }, { shiftKey: true }, { altKey: true }]) {
    assert.equal(panelToolShortcut({ ...event, ...override }), null);
  }
  assert.equal(panelToolShortcut({ ...event, key: "s", altKey: true, altGraph: true }), null);
});
