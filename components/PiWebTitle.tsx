"use client";

import { useLayoutEffect } from "react";

export const BRAND_TEXT = "yun";

export function PiWebTitle({ onWidthChange }: { onWidthChange?: () => void }) {
  useLayoutEffect(() => { onWidthChange?.(); }, [onWidthChange]);
  return <span className="sidebar-brand">{BRAND_TEXT}</span>;
}
