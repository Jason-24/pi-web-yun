export const PET_PREFERENCES_KEY = "pi-yun-pet-preferences";
export type PetPreferences = { name: string; quiet: boolean };
export const DEFAULT_PET_PREFERENCES: PetPreferences = { name: "", quiet: false };

export function normalizePetName(value: unknown): string {
  return typeof value === "string" ? Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "").trim()).slice(0, 24).join("") : "";
}

export function parsePetPreferences(raw: string | null): PetPreferences {
  try {
    const value = JSON.parse(raw ?? "null");
    return { name: normalizePetName(value?.name), quiet: value?.quiet === true };
  } catch { return { ...DEFAULT_PET_PREFERENCES }; }
}
