"use client";

import { useI18n } from "@/hooks/useI18n";
import type { CareNotice } from "@/lib/pet-care";
import styles from "./PetWidget.module.css";

export function PetCareNotice({ notice, onRespond }: { notice: CareNotice; onRespond(id: string, action: "ack" | "snooze" | "today"): void }) {
  const { t } = useI18n();
  return <div>
    <strong className={styles.careNoticeTitle}>{t(notice.focusDone ? "pet.care.focusDone" : "pet.care.reminder")}</strong>
    <span>{notice.kinds.map((kind) => t(`pet.care.line.${kind}.${notice.variant}`)).join(" ") || t("pet.care.focusRest")}</span>
    <div className={styles.careButtons}>
      <button type="button" onClick={() => onRespond(notice.id, "ack")}>{t("pet.care.ack")}</button>
      <button type="button" onClick={() => onRespond(notice.id, "snooze")}>{t("pet.care.snooze")}</button>
      {notice.kinds.length > 0 && <button type="button" onClick={() => onRespond(notice.id, "today")}>{t("pet.care.skipToday")}</button>}
    </div>
  </div>;
}
