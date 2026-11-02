"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getFileName } from "@/lib/file-paths";
import { sessionDisplayTitle } from "@/lib/session-fork-name";
import { isPlainActivation, sessionDeepLink } from "@/lib/session-links";
import type { SessionInfo } from "@/lib/types";
import { ChevronIcon, ComposeIcon, FolderIcon, MessageIcon } from "./SidebarIcons";
import { WelcomeMark } from "./WelcomeMark";

const RECENT_PAGE_SIZE = 8;

interface Props {
  sessions: SessionInfo[];
  runningSessionIds: Set<string>;
  cwd: string | null;
  onSelectSession(session: SessionInfo): void;
  onNewSession(): void;
  onOpenProject(): void;
}

export function HomeView({ sessions, runningSessionIds, cwd, onSelectSession, onNewSession, onOpenProject }: Props) {
  const { t, locale } = useI18n();
  const [visibleCount, setVisibleCount] = useState(RECENT_PAGE_SIZE);
  const recent = sessions
    .filter((session) => session.relation?.kind !== "subagent")
    .sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
  const hasMore = visibleCount < recent.length;
  const dateFormat = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });

  return (
    <div className="home-view" role="region" aria-label={t("navigation.home")}>
      <div className="home-content">
        <div className="home-intro">
          <WelcomeMark />
          <h1>{t("chat.newSessionWelcome")}</h1>
          <p>{t("home.description")}</p>
        </div>
        <div className="home-actions">
          <button type="button" className="home-new-task" aria-describedby="home-project-context" onClick={onNewSession}>
            <ComposeIcon size={16} /><span>{t("home.newTask")}</span>
          </button>
          <button type="button" className="home-open-project" onClick={onOpenProject}>
            <FolderIcon size={16} /><span>{t("home.openProject")}</span>
          </button>
          <span id="home-project-context" className="home-project-context" title={cwd ?? undefined}>
            {cwd && <FolderIcon size={14} />}
            <span>{cwd ? getFileName(cwd) || cwd : t("home.chooseProject")}</span>
          </span>
        </div>
        <section className="home-recent" aria-labelledby="home-recent-title">
          <h2 id="home-recent-title">{t("home.recentTasks")}</h2>
          {recent.length ? <div className="home-session-list" id="home-session-list">
            {recent.slice(0, visibleCount).map((session) => {
              const modified = new Date(session.modified);
              const title = sessionDisplayTitle(session);
              return (
                <a key={session.id} className="home-session" href={sessionDeepLink(session.id)}
                  onClick={(event) => {
                    if (!isPlainActivation(event)) return;
                    event.preventDefault();
                    onSelectSession(session);
                  }}>
                  <MessageIcon size={17} />
                  <span className="home-session-details">
                    <span className="home-session-title" title={title}>{title}</span>
                    <span className="home-session-project" title={session.cwd}>{getFileName(session.projectRoot || session.cwd) || session.cwd}</span>
                  </span>
                  {runningSessionIds.has(session.id) ? <span className="home-running">{t("home.running")}</span>
                    : Number.isFinite(modified.getTime()) && <time dateTime={modified.toISOString()}>{dateFormat.format(modified)}</time>}
                </a>
              );
            })}
          </div> : <p className="home-empty">{t("home.noTasks")}</p>}
          {recent.length > RECENT_PAGE_SIZE && <button type="button" className="home-recent-more"
            aria-controls="home-session-list" data-show-less={!hasMore}
            onClick={() => setVisibleCount(hasMore ? visibleCount + RECENT_PAGE_SIZE : RECENT_PAGE_SIZE)}>
            <span>{t(hasMore ? "home.showMore" : "home.showLess")}</span><ChevronIcon size={14} />
          </button>}
        </section>
      </div>
    </div>
  );
}
