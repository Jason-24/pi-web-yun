"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_PET_PREFERENCES, normalizePetName, parsePetPreferences, PET_PREFERENCES_KEY, type PetPreferences } from "@/lib/pet-preferences";

export function usePetPreferences() {
  const [preferences, setPreferences] = useState(DEFAULT_PET_PREFERENCES);
  useEffect(() => {
    try { setPreferences(parsePetPreferences(localStorage.getItem(PET_PREFERENCES_KEY))); } catch { /* Storage is optional. */ }
    const sync = (event: StorageEvent) => {
      if (event.key === PET_PREFERENCES_KEY || event.key === null) {
        try { setPreferences(parsePetPreferences(localStorage.getItem(PET_PREFERENCES_KEY))); } catch { /* Storage is optional. */ }
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const updatePreferences = useCallback((next: Partial<PetPreferences>) => {
    setPreferences((current) => {
      // Read first so a name change cannot overwrite another tab's quiet switch.
      let saved = current;
      try { const raw = localStorage.getItem(PET_PREFERENCES_KEY); if (raw !== null) saved = parsePetPreferences(raw); } catch { /* Use page state. */ }
      const merged = { ...saved, ...next, name: normalizePetName(next.name ?? saved.name) };
      try { localStorage.setItem(PET_PREFERENCES_KEY, JSON.stringify(merged)); } catch { /* Page state still works. */ }
      return merged;
    });
  }, []);
  return { preferences, updatePreferences };
}
