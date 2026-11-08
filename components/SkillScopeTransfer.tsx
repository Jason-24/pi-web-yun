"use client";

import { useId, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SkillInfo } from "@/lib/api-types";
import { ConfigButton } from "./SettingsUi";

export interface SkillTransferResult { targetPath: string; undoToken: string; mode: "move" | "copy"; }
interface Preview { targetPath: string; targetScope: "project" | "global"; }

export function SkillScopeTransfer({ skill, cwd, projectResourcesLoaded, busy, onBusy, onApplied }: {
  skill: SkillInfo; cwd: string; projectResourcesLoaded: boolean; busy: boolean;
  onBusy: (busy: boolean) => void; onApplied: (result: SkillTransferResult) => Promise<void>;
}) {
  const { t } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"move" | "copy">("move");
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  if (!skill.install) return null;
  const targetScope = skill.install.scope === "global" ? "project" : "global";
  const scopeLabel = t(`skills.scope.${targetScope}`);
  const parseError = (data: { code?: string; targetPath?: string; details?: string }) => {
    const known = ["conflict", "project-untrusted", "unsupported", "linked-files", "overlap", "source-changed", "invalid-lock", "too-large", "undo-expired", "undo-changed", "recover"];
    const code = data.code && known.includes(data.code) ? data.code : "failed";
    setError(t(`skills.transfer.error.${code}`));
    setDetails(data.targetPath ?? data.details ?? null);
  };
  const show = async () => {
    setOpen(true); setLoading(true); setError(null); setDetails(null); setPreview(null);
    try {
      const response = await fetch("/api/skills/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preview", cwd, filePath: skill.filePath, package: skill.install!.package }) });
      const data = await response.json();
      if (!response.ok) { parseError(data); return; }
      setPreview(data as Preview);
    } catch { setError(t("skills.transfer.error.failed")); }
    finally { setLoading(false); }
  };
  const apply = async () => {
    if (!preview) return;
    onBusy(true); setError(null); setDetails(null);
    try {
      const response = await fetch("/api/skills/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "apply", cwd, filePath: skill.filePath, package: skill.install!.package, mode, sharedAcknowledged: true }) });
      const data = await response.json();
      if (!response.ok) { parseError(data); return; }
      await onApplied({ ...data, mode } as SkillTransferResult);
      setOpen(false);
    } catch { setError(t("skills.transfer.error.failed")); }
    finally { onBusy(false); }
  };
  return <div className="skills-scopeTransfer">
    <div className="skills-scopeTrigger">
      <span>{t("skills.transfer.intro")}</span>
      <ConfigButton size="small" onClick={() => { if (open) setOpen(false); else void show(); }} disabled={busy || !projectResourcesLoaded} aria-expanded={open} aria-controls={id}>{t("skills.transfer.open")}</ConfigButton>
    </div>
    {!projectResourcesLoaded && <p className="skills-transferNote">{t("skills.transfer.error.project-untrusted")}</p>}
    {open && <section id={id} className="skills-transferForm" aria-label={t("skills.transfer.title")}>
      <div className="skills-transferHeading"><h3>{t("skills.transfer.title")}</h3><span>{t(`skills.scope.${skill.install.scope}`)} → {scopeLabel}</span></div>
      {targetScope === "project" && <p className="skills-transferNote">{t("skills.currentProject")}: <code>{cwd}</code></p>}
      {loading && <p role="status">{t("i18n.loading")}</p>}
      {preview && <>
        <fieldset className="skills-transferModes" disabled={busy}>
          <legend>{t("skills.transfer.mode")}</legend>
          {(["move", "copy"] as const).map((value) => <label key={value} className={mode === value ? "is-selected" : undefined}>
            <input type="radio" name={`${id}-mode`} value={value} checked={mode === value} onChange={() => setMode(value)} />
            <span><strong>{t(`skills.transfer.${value}`)}</strong><small>{t(`skills.transfer.${value}Help`)}</small></span>
          </label>)}
        </fieldset>
        <div className="skills-transferDestination"><span>{t("skills.transfer.destination")}</span><code>{preview.targetPath}</code></div>
        <p className="skills-transferNote">{t("skills.transfer.fileVersionHelp")}</p>
        <p className="skills-transferImpact">{t(mode === "copy" ? "skills.transfer.copyImpact" : skill.install.scope === "global" ? "skills.transfer.globalMoveImpact" : "skills.transfer.projectMoveImpact")}</p>
      </>}
      {error && <div role="alert" className="skills-error">{error}{details && <pre className="skills-transferErrorDetail">{details}</pre>}</div>}
      <div className="skills-transferActions">
        <ConfigButton size="small" onClick={() => setOpen(false)} disabled={busy}>{t("i18n.cancel")}</ConfigButton>
        {preview && <ConfigButton variant="primary" size="small" onClick={() => void apply()} disabled={busy}>{busy ? t("skills.transfer.working") : t(mode === "move" ? "skills.transfer.confirmMove" : "skills.transfer.confirmCopy", { scope: scopeLabel })}</ConfigButton>}
      </div>
    </section>}
  </div>;
}
