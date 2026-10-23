"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { I18nProvider, useI18n } from "@/hooks/useI18n";
import styles from "./preview.module.css";

function Preview() {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{ setAutoRotate: (value: boolean) => void; front: () => void } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [rotating, setRotating] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let dispose: (() => void) | undefined;
    void import("@/components/PetModelPreviewScene").then(async ({ mountPetModelPreview }) => {
      if (!hostRef.current || controller.signal.aborted) return;
      const scene = await mountPetModelPreview(hostRef.current, controller.signal);
      if (controller.signal.aborted) { scene.dispose(); return; }
      sceneRef.current = scene; dispose = scene.dispose; setStatus("ready");
    }).catch(() => { if (!controller.signal.aborted) setStatus("error"); });
    return () => { controller.abort(); dispose?.(); sceneRef.current = null; };
  }, []);
  return <main className={styles.page}>
    <header className={styles.header}>
      <Link href="/">← {t("pet.preview.back")}</Link>
      <span className={styles.tag}>{t("pet.preview.tag")}</span>
    </header>
    <div className={styles.layout}>
      <section className={styles.copy}>
        <p className={styles.eyebrow}>{t("pet.preview.eyebrow")}</p>
        <h1>{t("pet.preview.title")}</h1>
        <p>{t("pet.preview.description")}</p>
        <p className={styles.note}>{t("pet.preview.note")}</p>
        <div className={styles.controls}>
          <button type="button" disabled={status !== "ready"} onClick={() => {
            setRotating(!rotating); sceneRef.current?.setAutoRotate(!rotating);
          }}>{t(rotating ? "pet.preview.stop" : "pet.preview.rotate")}</button>
          <button type="button" disabled={status !== "ready"} onClick={() => {
            setRotating(false); sceneRef.current?.setAutoRotate(false); sceneRef.current?.front();
          }}>{t("pet.front")}</button>
        </div>
        <a className={styles.source} href="https://github.com/kblood/CharacterCreator" target="_blank" rel="noreferrer">{t("pet.preview.source")} ↗</a>
      </section>
      <section className={styles.stage} aria-label={t("pet.preview.title")}>
        <div ref={hostRef} className={styles.canvas} />
        {status !== "ready" && <p className={styles.message} role="status">{t(status === "error" ? "pet.preview.error" : "pet.loading3d")}</p>}
        <p className={styles.hint}>{t("pet.preview.hint")}</p>
      </section>
    </div>
  </main>;
}

export default function PetPreviewPage() { return <I18nProvider><Preview /></I18nProvider>; }
