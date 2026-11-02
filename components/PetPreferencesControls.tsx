"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { normalizePetName, type PetPreferences } from "@/lib/pet-preferences";
import styles from "./PetWidget.module.css";

export function PetPreferencesControls({ preferences, defaultName, onChange }: {
  preferences: PetPreferences; defaultName: string; onChange(next: Partial<PetPreferences>): void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(preferences.name);
  useEffect(() => setDraft(preferences.name), [preferences.name]);
  return <div className={styles.preferences}>
    <label>{t("pet.customName")}<input value={draft} placeholder={defaultName} maxLength={48} onChange={(event) => setDraft(event.target.value)}
      onBlur={() => { const name = normalizePetName(draft); setDraft(name); onChange({ name }); }}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} /></label>
    <label className={styles.quietSwitch}><input type="checkbox" checked={preferences.quiet} onChange={(event) => onChange({ quiet: event.target.checked })} />{t("pet.quiet")}</label>
    <p>{t("pet.quietHint")}</p><p>{t("pet.preferencesHint")}</p>
  </div>;
}
