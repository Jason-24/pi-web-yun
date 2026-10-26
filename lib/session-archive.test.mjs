import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getArchivedSessions, filterArchivedSessions } = await jiti.import("./session-archive.ts");
const { emptySessionUiState, applySessionUiStateRequest } = await jiti.import("./session-ui-state-shared.ts");
const archivedAt = Date.parse("2026-10-26T00:00:00Z");
const session = (id, extra = {}) => ({ id, path: "", cwd: "D:/work/project", projectRoot: "D:/work/project", projectKey: "project",
  created: "2026-10-20T00:00:00Z", modified: "2026-10-21T00:00:00Z", firstMessage: "检查 API", messageCount: 2, ...extra });
const stateFor = (flags) => ({ ...emptySessionUiState(), sessions: flags, projectNames: { project: "支付项目" } });

test("archive entries use family roots, saved project names and archive-time order", () => {
  const root = session("root");
  const child = session("child", { relation: { kind: "subagent", parentSessionId: "root", profile: "test", status: "completed", description: "child" } });
  const fork = session("fork", { relation: { kind: "fork", originSessionId: "root" } });
  const state = stateFor({ root: { archivedAt }, fork: { archivedAt: archivedAt + 1 } });
  const entries = getArchivedSessions([root, child, fork, session("live")], state, new Set());
  assert.deepEqual(entries.map((entry) => entry.session.id), ["fork", "root"]);
  assert.deepEqual(entries[0].project, { key: "project", root: "D:/work/project", name: "支付项目" });
  assert.equal(entries[1].archivedAt, archivedAt);
});

test("activity on the root or any running family member removes it from the archive", () => {
  const root = session("root");
  const child = session("child", { relation: { kind: "subagent", parentSessionId: "root", profile: "test", status: "running", description: "child" } });
  const state = stateFor({ root: { archivedAt } });
  assert.equal(getArchivedSessions([root, child], state, new Set(["child"])).length, 0);
  assert.equal(getArchivedSessions([session("root", { modified: "2026-10-27T00:00:00Z" })], state, new Set()).length, 0);
  assert.equal(getArchivedSessions([session("root", { modified: "2026-10-27T00:00:00Z", detailsPending: true })], state, new Set()).length, 1);
});

test("search matches titles, first prompts, saved project labels and Windows paths", () => {
  const entries = getArchivedSessions([session("root", { name: "修复 Login 接口" })], stateFor({ root: { archivedAt } }), new Set());
  for (const query of ["login", "LOGIN 支付", "检查 API", "D:/work/project"]) assert.equal(filterArchivedSessions(entries, query, null).length, 1, query);
  assert.equal(filterArchivedSessions(entries, "no match", null).length, 0);
  assert.equal(filterArchivedSessions(entries, "", "other-project").length, 0);
  assert.equal(filterArchivedSessions(entries, "", "project").length, 1);
});

test("restoring clears only the root archive flag and preserves the pin and original project", () => {
  const root = session("root");
  const state = stateFor({ root: { archivedAt, pinnedAt: archivedAt - 1 } });
  const { state: next } = applySessionUiStateRequest(state, { action: "set", ids: ["root"], archived: false }, archivedAt + 1);
  assert.equal(next.sessions.root.archivedAt, undefined);
  assert.equal(next.sessions.root.pinnedAt, archivedAt - 1);
  assert.deepEqual(next.projectNames, state.projectNames);
  assert.equal(getArchivedSessions([root], next, new Set()).length, 0);
  assert.equal(state.sessions.root.archivedAt, archivedAt, "the selector and update do not mutate their input");
});
