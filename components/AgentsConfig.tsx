"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ProjectTrustStatus, SubagentProfilesResponse, SubagentSettingsResponse } from "@/lib/api-types";
import { sendAgentCommand } from "@/lib/agent-client";
import { displayPathWithin, shortenPath } from "@/lib/display-path";
import type { ModelsData } from "@/lib/models-cache";
import { isSubagentProfileOverridden } from "@/lib/subagent-profile-precedence";
import type { SubagentProfile, SubagentScope, SubagentWritableScope } from "@/lib/subagents";
import {
  getLastSettingsSelection,
  setLastSettingsSelection,
} from "@/lib/settings-navigation";
import {
  ConfigButton,
  ConfigDetail,
  ConfigDetailActions,
  ConfigDetailHeader,
  ConfigDetailHeaderInfo,
  ConfigDetailStack,
  ConfigEmptyState,
  ConfigField,
  ConfigFooter,
  ConfigListAction,
  ConfigPanelShell,
  ConfigSaveTarget,
  ConfigScopeTag,
  ConfigSidebar,
  ConfigSidebarGroupLabel,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarText,
  ConfigSplitView,
  ConfigStatusDot,
  ConfigSwitch,
} from "./SettingsUi";
import { ModelSelector } from "./ModelSelector";
import { projectTrustReloadKey } from "./settings-ui-helpers";
import { listenForStackedDialogEscape } from "@/lib/stacked-dialog";

const TOOL_OPTIONS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const THINKING_OPTIONS = ["", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

type EditableProfile = Omit<SubagentProfile, "scope" | "filePath">;
type EditorMode = "view" | "edit" | "create";

const EMPTY_PROFILE: EditableProfile = {
  name: "custom-agent",
  displayName: "Custom agent",
  description: "",
  systemPrompt: "",
  tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
  loadSkills: false,
  loadExtensions: false,
  codemode: "off",
  mcp: "off",
  promptMode: "append",
  inheritContext: false,
  runInBackground: false,
  enabled: true,
};

const inputStyle: CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 38,
  padding: "0 11px",
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 12,
  outline: "none",
};

const disabledInputStyle: CSSProperties = {
  background: "var(--bg-panel)",
  color: "var(--text-dim)",
  cursor: "default",
};

function editableProfile(profile: SubagentProfile): EditableProfile {
  return {
    name: profile.name,
    displayName: profile.displayName,
    description: profile.description,
    systemPrompt: profile.systemPrompt,
    tools: [...profile.tools],
    loadSkills: profile.loadSkills,
    ...(profile.skills !== undefined ? { skills: [...profile.skills] } : {}),
    loadExtensions: profile.loadExtensions,
    codemode: profile.codemode ?? "off",
    mcp: profile.mcp ?? "off",
    ...(profile.extensions !== undefined ? { extensions: [...profile.extensions] } : {}),
    promptMode: profile.promptMode,
    ...(profile.model ? { model: profile.model } : {}),
    ...(profile.thinking ? { thinking: profile.thinking } : {}),
    ...(profile.maxTurns ? { maxTurns: profile.maxTurns } : {}),
    inheritContext: profile.inheritContext,
    runInBackground: profile.runInBackground,
    enabled: profile.enabled,
  };
}

/**
 * The model a profile reference names. It may end in pi's `:<thinking level>` (`provider/model:high`),
 * which the runtime reads as the model plus its level; a listed id that contains a colon matches whole.
 */
function profileModelBase(reference: string, isListed: (reference: string) => boolean): string {
  if (isListed(reference)) return reference;
  const colon = reference.lastIndexOf(":");
  const level = reference.slice(colon + 1);
  return colon > 0 && level && (THINKING_OPTIONS as readonly string[]).includes(level) ? reference.slice(0, colon) : reference;
}

function profileKey(profile: Pick<SubagentProfile, "scope" | "name">): string {
  return `${profile.scope}:${profile.name}`;
}

function duplicateProfileName(name: string, profiles: readonly SubagentProfile[]): string {
  const existing = new Set(profiles.map((profile) => profile.name.toLowerCase()));
  const base = `${name}-copy`;
  let candidate = base;
  let suffix = 2;
  while (existing.has(candidate.toLowerCase())) candidate = `${base}-${suffix++}`;
  return candidate;
}

function isWritableScope(scope: SubagentScope): scope is SubagentWritableScope {
  return scope === "global" || scope === "project";
}

/**
 * A built-in has no file to edit, so its fields stay read-only, but its switch is
 * live: the server records the name in `agents/settings.json` instead of writing a
 * copy of the profile to disk.
 */
function isTogglableScope(scope: SubagentScope): boolean {
  return isWritableScope(scope) || scope === "builtin";
}

function displayProfilePath(profile: SubagentProfile, cwd: string): string | null {
  if (!profile.filePath) return null;
  return profile.scope === "project" || profile.scope === "workspace"
    ? displayPathWithin(profile.filePath, cwd)
    : shortenPath(profile.filePath);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <ConfigField label={label}>{children}</ConfigField>;
}

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className={`agents-option${checked ? " is-selected" : ""}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

function ProfileOverview({ profile }: { profile: EditableProfile }) {
  const { t } = useI18n();
  return <div className="agents-profile-overview">
    <section className="agents-profile-section">
      <h4>{t("agents.prompt")}</h4>
      <pre className="agents-prompt-preview">{profile.systemPrompt || t("agents.promptEmpty")}</pre>
    </section>
    <section className="agents-profile-section">
      <h4>{t("agents.permissions")}</h4>
      <div className="agents-summary-group"><span>{t("agents.tools")}</span><div className="agents-tags">{profile.tools.length ? profile.tools.map(tool => <code key={tool}>{tool}</code>) : <span>{t("agents.noTools")}</span>}</div></div>
      <div className="agents-summary-group"><span>{t("agents.resources")}</span><div className="agents-tags">{([
        ["agents.loadSkills", profile.loadSkills], ["agents.loadExtensions", profile.loadExtensions], ["agents.mcp", profile.mcp === "on"],
      ] as const).map(([label, enabled]) => <span key={label} className={enabled ? "" : "is-muted"}>{t(label)} · {t(enabled ? "agents.on" : "agents.off")}</span>)}</div></div>
      {profile.loadSkills && profile.skills !== undefined && <p className="agents-help">{profile.skills.length ? t("agents.skillsOnly", { skills: profile.skills.join(", ") }) : t("agents.skillsNone")}</p>}
      {profile.loadExtensions && profile.extensions !== undefined && <p className="agents-help">{profile.extensions.length ? t("agents.extensionsOnly", { extensions: profile.extensions.join(", ") }) : t("agents.extensionsNone")}</p>}
    </section>
    <section className="agents-profile-section">
      <h4>{t("agents.runtime")}</h4>
      <dl className="agents-summary-grid">{[
        [t("agents.model"), profile.model || t("agents.inherit")],
        [t("agents.thinking"), profile.thinking || t("agents.inherit")],
        [t("agents.maxTurns"), profile.maxTurns ?? t("agents.unlimited")],
        [t("agents.codemode"), t(`agents.codemode.${profile.codemode ?? "off"}`)],
        [t("agents.inheritContext"), t(profile.inheritContext ? "agents.on" : "agents.off")],
        [t("agents.background"), t(profile.runInBackground ? "agents.on" : "agents.off")],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </section>
  </div>;
}

function ProfileConfirmDialog({ onCancel, onConfirm, deleteName }: { onCancel: () => void; onConfirm: () => void; deleteName?: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    const stopListening = listenForStackedDialogEscape(document, () => cancelRef.current());
    return () => { stopListening(); if (dialog?.open) dialog.close(); };
  }, []);
  return <dialog ref={ref} className="agents-discard-dialog" aria-labelledby="agents-discard-title"
    onCancel={event => { event.preventDefault(); onCancel(); }}
    onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }}>
    <h3 id="agents-discard-title">{deleteName ? t("agents.deleteConfirm", { name: deleteName }) : t("agents.unsavedTitle")}</h3>
    <p>{t(deleteName ? "agents.deleteHint" : "agents.unsavedHint")}</p>
    <div><ConfigButton autoFocus onClick={onCancel}>{t(deleteName ? "i18n.cancel" : "agents.keepEditing")}</ConfigButton><ConfigButton variant="danger" onClick={onConfirm}>{t(deleteName ? "agents.delete" : "agents.discard")}</ConfigButton></div>
  </dialog>;
}

export function AgentsConfig({
  cwd,
  sessionId = null,
  onClose,
  onReloaded,
  embedded = false,
  trust,
}: {
  cwd: string;
  sessionId?: string | null;
  onClose: () => void;
  onReloaded?: () => void;
  embedded?: boolean;
  /** The page's trust status for `cwd`; a new decision loads the model list again. */
  trust?: ProjectTrustStatus | null;
}) {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<SubagentProfile[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelsData["modelList"]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(() => getLastSettingsSelection("agents", cwd));
  const [draft, setDraft] = useState<EditableProfile>(EMPTY_PROFILE);
  const [baseline, setBaseline] = useState(JSON.stringify(EMPTY_PROFILE));
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const createSource = useRef<string | null>(null);
  const createScope = useRef<SubagentWritableScope>("global");
  const profileTitleRef = useRef<HTMLHeadingElement>(null);
  const focusProfileTitle = () => requestAnimationFrame(() => profileTitleRef.current?.focus({ preventScroll: true }));
  const [mode, setMode] = useState<EditorMode>("view");
  const [targetScope, setTargetScope] = useState<SubagentWritableScope>("global");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [builtInEnabled, setBuiltInEnabled] = useState(false);
  const [maxConcurrent, setMaxConcurrent] = useState(10);
  const savedMaxConcurrent = useRef(10);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [reloadNeeded, setReloadNeeded] = useState(false);
  const [reloading, setReloading] = useState(false);

  const selected = useMemo(
    () => profiles.find((profile) => profileKey(profile) === selectedKey) ?? null,
    [profiles, selectedKey],
  );
  const modelSelectorOptions = useMemo(() => modelOptions.map((model) => ({
    provider: model.provider,
    modelId: model.id,
    name: model.name,
  })), [modelOptions]);

  const loadProfiles = useCallback(async (preferredKey?: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/subagents/profiles?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
      const data = await response.json() as Partial<SubagentProfilesResponse> & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      const next = data.profiles ?? [];
      setProfiles(next);
      const rememberedKey = preferredKey ?? getLastSettingsSelection("agents", cwd);
      const chosen = next.find((profile) => profileKey(profile) === rememberedKey)
        ?? next.find((profile) => profile.scope === "project")
        ?? next.find((profile) => profile.scope === "global")
        ?? next[0]
        ?? null;
      setSelectedKey(chosen ? profileKey(chosen) : null);
      if (chosen) {
        setDraft(editableProfile(chosen));
        setBaseline(JSON.stringify(editableProfile(chosen)));
        setMode("view");
        if (isWritableScope(chosen.scope)) setTargetScope(chosen.scope);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    const controller = new AbortController();
    setSettingsLoading(true);
    setSettingsError(null);
    void (async () => {
      try {
        const response = await fetch("/api/subagents/settings", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json() as Partial<SubagentSettingsResponse> & { error?: string };
        if (!response.ok || data.error || typeof data.enabled !== "boolean") {
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }
        setBuiltInEnabled(data.enabled);
        if (typeof data.maxConcurrent === "number") { setMaxConcurrent(data.maxConcurrent); savedMaxConcurrent.current = data.maxConcurrent; }
      } catch (cause) {
        if (controller.signal.aborted) return;
        setSettingsError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!controller.signal.aborted) setSettingsLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (selectedKey) setLastSettingsSelection("agents", selectedKey, cwd);
  }, [cwd, selectedKey]);

  // The model list follows the folder's trust: GET /api/models leaves out an
  // untrusted project's extensions, which can register providers. Trust can
  // change while this section stays mounted (hidden) in Settings, by trusting
  // from Settings › MCP; a new decision loads the list again in place, keeping
  // any profile draft.
  const trustKey = projectTrustReloadKey(trust);
  useEffect(() => {
    const controller = new AbortController();
    setModelsLoading(true);
    setModelsError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/models?cwd=${encodeURIComponent(cwd)}`, { signal: controller.signal });
        const data = await response.json() as Partial<ModelsData> & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        setModelOptions(data.modelList ?? []);
        setModelsError(data.modelError ?? null);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setModelsError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!controller.signal.aborted) setModelsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [cwd, trustKey]);

  const selectProfile = (profile: SubagentProfile) => {
    setSavedOk(false);
    setSelectedKey(profileKey(profile));
    setDraft(editableProfile(profile));
    setBaseline(JSON.stringify(editableProfile(profile)));
    setMode("view");
    if (isWritableScope(profile.scope)) setTargetScope(profile.scope);
    setError(null);
  };

  const beginCreate = () => {
    setSavedOk(false);
    createSource.current = selectedKey;
    createScope.current = "global";
    let name = "custom-agent";
    let suffix = 2;
    while (profiles.some((profile) => profile.name === name)) name = `custom-agent-${suffix++}`;
    setSelectedKey(null);
    setDraft({ ...EMPTY_PROFILE, name, displayName: name });
    setBaseline(JSON.stringify({ ...EMPTY_PROFILE, name, displayName: name }));
    setMode("create");
    setTargetScope("global");
    setError(null);
  };

  const beginDuplicate = () => {
    if (!selected) return;
    setSavedOk(false);
    createSource.current = selectedKey;
    createScope.current = isWritableScope(selected.scope) ? selected.scope : "global";
    const name = duplicateProfileName(selected.name, profiles);
    setSelectedKey(null);
    setDraft({
      ...editableProfile(selected),
      name,
      displayName: t("agents.copyName", { name: selected.displayName }),
    });
    setBaseline(JSON.stringify({ ...editableProfile(selected), name, displayName: t("agents.copyName", { name: selected.displayName }) }));
    setMode("create");
    setTargetScope(isWritableScope(selected.scope) ? selected.scope : "global");
    setError(null);
  };

  const save = async () => {
    if (!validDraft || saving || toggling || (!creating && !dirty)) return;
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const response = await fetch("/api/subagents/profiles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope: targetScope, profile: draft }),
      });
      const data = await response.json() as { profile?: SubagentProfile; error?: string };
      if (!response.ok || data.error || !data.profile) throw new Error(data.error ?? `HTTP ${response.status}`);
      await loadProfiles(profileKey(data.profile));
      setSavedOk(true);
      focusProfileTitle();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selected || !isWritableScope(selected.scope)) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/subagents/profiles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope: selected.scope, name: selected.name }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      await loadProfiles();
      focusProfileTitle();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const editing = mode !== "view";
  const creating = mode === "create";
  const dirty = editing && (JSON.stringify(draft) !== baseline || (creating && targetScope !== createScope.current));
  const validDraft = Boolean(draft.name.trim()) && (draft.maxTurns === undefined || (Number.isInteger(draft.maxTurns) && draft.maxTurns > 0));
  const requestNavigation = (action: () => void) => {
    if (saving || toggling) return;
    if (dirty) setPendingNavigation(() => action);
    else action();
  };
  const cancelEditing = () => {
    const original = selected ?? profiles.find(profile => profileKey(profile) === createSource.current) ?? profiles[0];
    if (original) selectProfile(original);
    else { setMode("view"); setSelectedKey(null); }
    setSavedOk(false);
    focusProfileTitle();
  };
  const disabled = !editing || saving || toggling;
  const displayedScope = creating ? targetScope : selected?.scope;
  const displayedPath = creating
    ? targetScope === "global"
      ? `~/.pi/agent/agents/${draft.name || "..."}.md`
      : `./.pi/agents/${draft.name || "..."}.md`
    : selected
      ? displayProfilePath(selected, cwd) ?? t("agents.builtinPath")
      : "";
  const fullPath = creating ? displayedPath : selected?.filePath ?? displayedPath;
  const isListedModel = (reference: string) => modelOptions.some((model) => `${model.provider}/${model.id}` === reference);
  const draftModelBase = draft.model && profileModelBase(draft.model, isListedModel);
  const selectedModelAvailable = !draftModelBase || isListedModel(draftModelBase);
  const selectedModel = (() => {
    if (!draftModelBase) return null;
    const separator = draftModelBase.indexOf("/");
    return separator < 0
      ? { provider: "", modelId: draftModelBase }
      : { provider: draftModelBase.slice(0, separator), modelId: draftModelBase.slice(separator + 1) };
  })();
  const controlStyle = disabled ? { ...inputStyle, ...disabledInputStyle } : inputStyle;
  const switchDisabled = creating
    ? disabled
    : !selected || !isTogglableScope(selected.scope) || saving || toggling;
  const update = <K extends keyof EditableProfile>(key: K, value: EditableProfile[K]) => {
    setSavedOk(false);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  // As `buildSubagentPromptPlan()` decides: no tools, skills or extensions.
  const chatOnlyDraft = draft.tools.length === 0 && !draft.loadSkills && !draft.loadExtensions;

  const toggleEnabled = async (enabled: boolean) => {
    if (editing) {
      update("enabled", enabled);
      return;
    }
    if (!selected || !isTogglableScope(selected.scope)) return;
    setToggling(true);
    setError(null);
    try {
      const response = await fetch("/api/subagents/profiles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, scope: selected.scope, name: selected.name, enabled }),
      });
      const data = await response.json() as { profile?: SubagentProfile; error?: string };
      if (!response.ok || data.error || !data.profile) throw new Error(data.error ?? `HTTP ${response.status}`);
      const saved = data.profile;
      setProfiles((current) => current.map((profile) => profileKey(profile) === profileKey(saved) ? saved : profile));
      setDraft((current) => ({ ...current, enabled: saved.enabled }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setToggling(false);
    }
  };

  const toggleBuiltInSubagents = async (enabled: boolean) => {
    setSettingsSaving(true);
    setSettingsError(null);
    try {
      const response = await fetch("/api/subagents/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json() as Partial<SubagentSettingsResponse> & { error?: string };
      if (!response.ok || data.error || typeof data.enabled !== "boolean") {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      setBuiltInEnabled(data.enabled);
      setReloadNeeded(Boolean(sessionId));
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSettingsSaving(false);
    }
  };

  const updateMaxConcurrent = async (value: number) => {
    if (!Number.isInteger(value) || value < 1 || value > 32) { setSettingsError(t("agents.concurrentInvalid")); return; }
    setSettingsError(null);
    if (value === savedMaxConcurrent.current || settingsSaving) return;
    setSettingsSaving(true);
    setMaxConcurrent(value);
    setSettingsError(null);
    try {
      const response = await fetch("/api/subagents/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxConcurrent: value }),
      });
      const data = await response.json() as Partial<SubagentSettingsResponse> & { error?: string };
      if (!response.ok || data.error || typeof data.maxConcurrent !== "number") throw new Error(data.error ?? `HTTP ${response.status}`);
      setMaxConcurrent(data.maxConcurrent);
      savedMaxConcurrent.current = data.maxConcurrent;
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSettingsSaving(false);
    }
  };

  const reloadSession = async () => {
    if (!sessionId) return;
    setReloading(true);
    setSettingsError(null);
    try {
      await sendAgentCommand(sessionId, { type: "reload" });
      setReloadNeeded(false);
      onReloaded?.();
    } catch (cause) {
      setSettingsError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setReloading(false);
    }
  };

  return (
    <ConfigPanelShell embedded={embedded} title={t("common.agents")} subtitle={shortenPath(cwd)} closeLabel={t("agents.close")} onClose={onClose}>
      <div className="agents-panel">
      <div className="agents-feature-setting">
        <div className="agents-feature-copy">
          <strong>{t("agents.featureTitle")}</strong>
          <span>{t("agents.featureHint")}</span>
          {reloadNeeded && <span role="status" className="agents-feature-reload-notice">{t("agents.reloadRequired")}</span>}
        </div>
        <div className="agents-feature-actions">
          {reloadNeeded && sessionId && (
            <ConfigButton size="small" onClick={() => void reloadSession()} disabled={reloading || settingsSaving}>
              {reloading ? t("agents.reloading") : t("agents.reloadSession")}
            </ConfigButton>
          )}
          <label className="agents-concurrency-control" title={t("agents.maxConcurrentDescription")}>
            <span>{t("agents.maxConcurrent")}</span>
            <input
              aria-label={t("agents.maxConcurrent")}
              type="number"
              min={1}
              max={32}
              value={maxConcurrent}
              aria-invalid={!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 32 || undefined}
              disabled={settingsLoading || settingsSaving}
              onChange={(event) => setMaxConcurrent(Number(event.target.value))}
              onBlur={() => void updateMaxConcurrent(maxConcurrent)}
            />
          </label>
          <ConfigSwitch
            checked={builtInEnabled}
            disabled={settingsLoading || reloading}
            loading={settingsSaving}
            label={t("agents.builtInTitle")}
            onChange={(enabled) => void toggleBuiltInSubagents(enabled)}
          />
        </div>
      </div>
      <ConfigSplitView>
        <ConfigSidebar>
          <ConfigSidebarList>
              {loading ? (
                <div style={{ padding: 10, color: "var(--text-dim)", fontSize: 12 }}>{t("agents.loading")}</div>
              ) : (["project", "global", "workspace", "builtin"] as const).map((scope) => {
                const scopedProfiles = profiles.filter((profile) => profile.scope === scope);
                if (scopedProfiles.length === 0) return null;
                return (
                  <div key={scope} className="config-sidebar-group">
                    <ConfigSidebarGroupLabel>{t(`agents.scope.${scope}`)}</ConfigSidebarGroupLabel>
                    {scopedProfiles.map((profile) => {
                      const overridden = isSubagentProfileOverridden(profile, profiles);
                      return (
                        <ConfigSidebarItem
                          key={profileKey(profile)}
                          active={selectedKey === profileKey(profile) && !creating}
                          disabled={saving || toggling}
                          onClick={() => { if (selectedKey !== profileKey(profile) || creating) requestNavigation(() => selectProfile(profile)); }}
                        >
                          <ConfigStatusDot active={profile.enabled} />
                          <ConfigSidebarText className={`is-grow${profile.enabled ? "" : " is-muted"}`}>{profile.displayName}</ConfigSidebarText>
                          {overridden && <span className="agents-overridden-label">{t("agents.overridden")}</span>}
                        </ConfigSidebarItem>
                      );
                    })}
                  </div>
                );
              })}
          </ConfigSidebarList>
          <ConfigListAction
                active={creating}
                onClick={() => { if (!creating) requestNavigation(beginCreate); }}
                disabled={saving || toggling}
              >
                {t("agents.new")}
          </ConfigListAction>
        </ConfigSidebar>

        <ConfigDetail motionKey={JSON.stringify([selectedKey, mode])} resetScrollOnChange>
          <ConfigDetailStack className="is-fill">
              {!selected && !creating ? (
                <ConfigEmptyState>{t("agents.empty")}</ConfigEmptyState>
              ) : (
                <ConfigDetailStack className="agents-profile-content">
                  <ConfigDetailHeader>
                    <ConfigDetailHeaderInfo>
                      {/* A new profile chooses its scope where a saved one shows it. */}
                      {creating ? (
                        <ConfigSaveTarget
                          value={targetScope}
                          label={t("config.saveTo")}
                          options={(["global", "project"] as const).map((scope) => ({
                            value: scope,
                            label: t(`agents.scope.${scope}`),
                            disabled: saving,
                          }))}
                          path={displayedPath}
                          onChange={setTargetScope}
                        />
                      ) : (
                        <>
                          {displayedScope && (
                            <ConfigScopeTag scope={displayedScope}>{t(`agents.scope.${displayedScope}`)}</ConfigScopeTag>
                          )}
                          {selected?.filePath && <span title={fullPath} className="config-detail-path">
                            {displayedPath}
                          </span>}
                        </>
                      )}
                      <h3 ref={profileTitleRef} tabIndex={-1} className="agents-profile-title">{creating ? t("agents.new") : draft.displayName || draft.name}</h3>
                      {!creating && <code className="agents-profile-id">{draft.name}</code>}
                      {!editing && draft.description && <p className="agents-profile-description">{draft.description}</p>}
                    </ConfigDetailHeaderInfo>
                    <ConfigDetailActions>
                      {selected && mode === "view" && <ConfigButton variant={isWritableScope(selected.scope) ? "secondary" : "primary"} size="small" onClick={beginDuplicate} disabled={saving || toggling}>{t("agents.duplicate")}</ConfigButton>}
                      {selected && isWritableScope(selected.scope) && mode === "view" && <ConfigButton variant="primary" size="small" onClick={() => { setSavedOk(false); setBaseline(JSON.stringify(draft)); setMode("edit"); }}>{t("agents.edit")}</ConfigButton>}
                      <span className="agents-enabled-control"><span>{t(draft.enabled ? "agents.on" : "agents.off")}</span><ConfigSwitch checked={draft.enabled} disabled={switchDisabled} label={draft.enabled ? t("agents.disable") : t("agents.enable")} onChange={(checked) => void toggleEnabled(checked)} /></span>
                    </ConfigDetailActions>
                  </ConfigDetailHeader>
                  {!editing && <>
                    {selected && !isWritableScope(selected.scope) && <p className="agents-readonly-note">{t(selected.scope === "builtin" ? "agents.builtinHint" : "agents.readonlyHint")}</p>}
                    <ProfileOverview profile={draft} />
                    {selected && isWritableScope(selected.scope) && <div className="agents-delete-row"><ConfigButton variant="danger" size="small" disabled={saving || toggling} onClick={() => setConfirmDelete(true)}>{t("agents.delete")}</ConfigButton></div>}
                  </>}
                  {editing && <form id="agents-profile-form" className="agents-profile-form" onSubmit={event => { event.preventDefault(); void save(); }} onKeyDown={event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void save(); } }}>
                  <section className="agents-profile-section"><h4>{t("agents.basic")}</h4>
                  <div className="agents-identity-grid">
                    <Field label={t("agents.name")}>
                      {creating ? (
                        <input autoFocus aria-label={t("agents.name")} value={draft.name} disabled={disabled} onChange={(event) => update("name", event.target.value)} style={inputStyle} />
                      ) : (
                        <code style={{ minHeight: 34, display: "flex", alignItems: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", fontSize: 12 }}>
                          {draft.name}
                        </code>
                      )}
                    </Field>
                    <Field label={t("agents.displayName")}>
                      <input autoFocus={!creating} aria-label={t("agents.displayName")} value={draft.displayName} disabled={disabled} onChange={(event) => update("displayName", event.target.value)} style={controlStyle} />
                    </Field>
                  </div>
                  <Field label={t("agents.description")}>
                    <input aria-label={t("agents.description")} value={draft.description} disabled={disabled} onChange={(event) => update("description", event.target.value)} style={controlStyle} />
                  </Field>
                  </section>
                  <section className="agents-profile-section">
                  <Field label={t("agents.prompt")}>
                    <textarea className="agents-system-prompt" aria-label={t("agents.prompt")} value={draft.systemPrompt} disabled={disabled} onChange={(event) => update("systemPrompt", event.target.value)} style={{ ...controlStyle, height: 180, minHeight: 140, maxHeight: "60vh", padding: 9, overflow: "auto", resize: disabled ? "none" : "vertical", lineHeight: 1.5 }} />
                  </Field>
                  </section>
                  <section className="agents-profile-section"><h4>{t("agents.permissions")}</h4>
                  <div className="agents-tool-presets">{[
                    ["agents.toolsReadOnly", ["read", "grep", "find", "ls"]],
                    ["agents.toolsAll", TOOL_OPTIONS], ["agents.toolsClear", []],
                  ].map(([label, tools]) => <ConfigButton key={label as string} size="small" disabled={disabled} onClick={() => update("tools", [...draft.tools.filter(tool => !TOOL_OPTIONS.includes(tool)), ...(tools as string[])])}>{t(label as string)}</ConfigButton>)}</div>
                  <Field label={t("agents.tools")}>
                    <div className="agents-tool-options">
                      {TOOL_OPTIONS.map((tool) => (
                        <Toggle key={tool} label={tool} disabled={disabled} checked={draft.tools.includes(tool)} onChange={(checked) => update("tools", checked ? [...draft.tools, tool] : draft.tools.filter((item) => item !== tool))} />
                      ))}
                    </div>
                  </Field>

                  <Field label={t("agents.resources")}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 20px" }}>
                      <Toggle label={t("agents.loadSkills")} disabled={disabled} checked={draft.loadSkills} onChange={(checked) => update("loadSkills", checked)} />
                      <Toggle label={t("agents.loadExtensions")} disabled={disabled} checked={draft.loadExtensions} onChange={(checked) => update("loadExtensions", checked)} />
                      {/* A chat-only child cannot start with MCP on; the switch still turns it off. */}
                      <Toggle label={t("agents.mcp")} disabled={disabled || (chatOnlyDraft && draft.mcp !== "on")} checked={draft.mcp === "on"} onChange={(checked) => update("mcp", checked ? "on" : "off")} />
                    </div>
                    {/* `skills:` and `extensions:` lists are edited in the profile file; show what they load. */}
                    {draft.loadSkills && draft.skills !== undefined && (
                      <span style={{ color: "var(--text-dim)", fontSize: 11, lineHeight: 1.4, overflowWrap: "anywhere" }}>
                        {draft.skills.length > 0
                          ? t("agents.skillsOnly", { skills: draft.skills.join(", ") })
                          : t("agents.skillsNone")}
                      </span>
                    )}
                    {draft.loadExtensions && draft.extensions !== undefined && (
                      <span style={{ color: "var(--text-dim)", fontSize: 11, lineHeight: 1.4, overflowWrap: "anywhere" }}>
                        {draft.extensions.length > 0
                          ? t("agents.extensionsOnly", { extensions: draft.extensions.join(", ") })
                          : t("agents.extensionsNone")}
                      </span>
                    )}
                    {!disabled && chatOnlyDraft ? (
                      <span style={{ color: "var(--text-dim)", fontSize: 11, lineHeight: 1.4 }}>
                        {t("agents.mcpChatOnly")}
                      </span>
                    ) : draft.mcp === "on" && (
                      <span style={{ color: "var(--text-dim)", fontSize: 11, lineHeight: 1.4 }}>
                        {t("agents.mcpHint")}
                      </span>
                    )}
                  </Field>
                  </section>
                  <section className="agents-profile-section"><h4>{t("agents.runtime")}</h4>
                  <div className="agents-runtime-grid">
                    <Field label={t("agents.model")}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <ModelSelector
                          options={modelSelectorOptions}
                          value={selectedModel}
                          onChange={(provider, modelId) => update("model", `${provider}/${modelId}`)}
                          onClear={() => update("model", undefined)}
                          emptyLabel={modelsLoading ? t("agents.modelsLoading") : t("agents.inherit")}
                          selectedLabel={draft.model && !selectedModelAvailable
                            ? t("agents.modelUnavailable", { model: draft.model })
                            : draft.model !== draftModelBase ? draft.model : undefined}
                          disabled={disabled || modelsLoading || (modelOptions.length === 0 && !draft.model)}
                          ariaLabel={t("agents.model")}
                          variant="field"
                          placement="auto"
                        />
                        {modelsError && <span style={{ color: "#ef4444", fontSize: 10 }}>{modelsError}</span>}
                      </div>
                    </Field>
                    <Field label={t("agents.thinking")}>
                      <select aria-label={t("agents.thinking")} value={draft.thinking ?? ""} disabled={disabled} onChange={(event) => update("thinking", (event.target.value || undefined) as EditableProfile["thinking"])} style={controlStyle}>
                        {THINKING_OPTIONS.map((value) => <option key={value || "default"} value={value}>{value || t("agents.inherit")}</option>)}
                      </select>
                    </Field>
                    <Field label={t("agents.maxTurns")}>
                      <input aria-label={t("agents.maxTurns")} placeholder={t("agents.unlimited")} type="number" min={1} step={1} value={draft.maxTurns ?? ""} disabled={disabled} onChange={(event) => update("maxTurns", event.target.value ? Number(event.target.value) : undefined)} style={controlStyle} />
                    </Field>
                  </div>

                  <details className="agents-advanced"><summary>{t("agents.advanced")}</summary>
                  <Field label={t("agents.codemode")}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <select
                        aria-label={t("agents.codemode")}
                        value={draft.codemode ?? "off"}
                        disabled={disabled}
                        onChange={(event) => update("codemode", event.target.value as EditableProfile["codemode"])}
                        style={{ ...controlStyle, width: "auto", minWidth: 180, alignSelf: "flex-start" }}
                      >
                        <option value="inherit">{t("agents.codemode.inherit")}</option>
                        <option value="on">{t("agents.codemode.on")}</option>
                        <option value="off">{t("agents.codemode.off")}</option>
                      </select>
                      <span style={{ color: "var(--text-dim)", fontSize: 11, lineHeight: 1.4 }}>
                        {t("agents.codemodeHint")}
                      </span>
                    </div>
                  </Field>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 20px" }}>
                    <Toggle label={t("agents.inheritContext")} disabled={disabled} checked={draft.inheritContext} onChange={(checked) => update("inheritContext", checked)} />
                    <Toggle label={t("agents.background")} disabled={disabled} checked={draft.runInBackground} onChange={(checked) => update("runInBackground", checked)} />
                  </div>
                  </details>
                  </section>
                  </form>}
                </ConfigDetailStack>
              )}
          </ConfigDetailStack>
        </ConfigDetail>
      </ConfigSplitView>
      <ConfigFooter status={(settingsError || error) ? <span role="alert" style={{ color: "#ef4444" }}>{settingsError || error}</span> : <span role="status">{editing && !validDraft ? t("agents.invalidDraft") : dirty ? t("agents.unsaved") : savedOk ? t("i18n.saved") : editing ? t("agents.saveHint") : t("agents.viewHint")}</span>}>
        {editing && (
          <>
          <ConfigButton onClick={cancelEditing} disabled={saving || toggling}>{t("i18n.cancel")}</ConfigButton>
          <ConfigButton
            variant="primary"
            type="submit" form="agents-profile-form"
            disabled={saving || toggling || !validDraft || (!creating && !dirty)}
            className={savedOk ? "is-success" : undefined}
          >
            {savedOk && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="config-button-success-icon">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            <span>{savedOk ? t("i18n.saved") : saving ? t("agents.saving") : t("agents.save")}</span>
          </ConfigButton>
          </>
        )}
      </ConfigFooter>
      {pendingNavigation && <ProfileConfirmDialog onCancel={() => setPendingNavigation(null)} onConfirm={() => { const navigate = pendingNavigation; setPendingNavigation(null); navigate(); }} />}
      {confirmDelete && selected && <ProfileConfirmDialog deleteName={selected.displayName} onCancel={() => setConfirmDelete(false)} onConfirm={() => { setConfirmDelete(false); void remove(); }} />}
      </div>
    </ConfigPanelShell>
  );
}
