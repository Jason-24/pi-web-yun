import { listSessionFamilies } from "./session-family";
import { isFamilyArchived } from "./session-tree";
import { storedProjectName, type SessionUiState } from "./session-ui-state-shared";
import { getFileName } from "./file-paths";
import { sessionDisplayTitle } from "./session-fork-name";
import { workspaceKeyOf } from "./workspace-memory";
import type { SessionInfo } from "./types";

export interface ArchivedSession {
  session: SessionInfo;
  archivedAt: number;
  project: { key: string; root: string; name: string };
}

export interface ArchiveSnapshot {
  entries: ArchivedSession[];
  loaded: boolean;
  error: string | null;
}

/** The same family-root and automatic revival rules as the live sidebar. */
export function getArchivedSessions(sessions: readonly SessionInfo[], state: SessionUiState, runningIds: ReadonlySet<string>): ArchivedSession[] {
  return listSessionFamilies(sessions)
    .filter((family) => isFamilyArchived(family, state, runningIds))
    .map(({ root: session }) => {
      const key = workspaceKeyOf(session);
      const root = session.projectRoot || session.cwd;
      return { session, archivedAt: state.sessions[session.id].archivedAt!, project: { key, root, name: storedProjectName(state, key) ?? (getFileName(root) || root) } };
    })
    .sort((a, b) => b.archivedAt - a.archivedAt || a.session.id.localeCompare(b.session.id));
}

/** Search is intentionally local to session titles, first prompts and project paths. */
export function filterArchivedSessions(entries: readonly ArchivedSession[], query: string, projectKey: string | null): ArchivedSession[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (projectKey && entry.project.key !== projectKey) return false;
    const text = [sessionDisplayTitle(entry.session), entry.session.firstMessage, entry.project.name, entry.project.root, entry.session.cwd].join("\n").toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
