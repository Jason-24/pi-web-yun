import type { CSSProperties } from "react";

// Shared theme order for the toolbar menu. The appearance grid puts Breeze beside System.
// The rows line up by hue: each light theme sits above its dark counterpart; Rose and Slate have none.
export const THEME_OPTIONS = [
  { id: "auto", label: "settings.themeSystem", scheme: null },
  { id: "light", label: "settings.themeLight", scheme: "light" },
  { id: "mist", label: "settings.themeMist", scheme: "light" },
  { id: "lilac", label: "settings.themeLilac", scheme: "light" },
  { id: "sand", label: "settings.themeSand", scheme: "light" },
  { id: "rose", label: "settings.themeRose", scheme: "light" },
  { id: "dark", label: "settings.themeDark", scheme: "dark" },
  { id: "pine", label: "settings.themePine", scheme: "dark" },
  { id: "dusk", label: "settings.themeDusk", scheme: "dark" },
  { id: "ember", label: "settings.themeEmber", scheme: "dark" },
  { id: "slate", label: "settings.themeSlate", scheme: "dark" },
  { id: "contrast-light", label: "settings.themeContrastLight", scheme: "light" },
  { id: "contrast-dark", label: "settings.themeContrastDark", scheme: "dark" },
  { id: "zenburn", label: "settings.themeZenburn", scheme: "dark" },
  { id: "breeze", label: "settings.themeBreeze", scheme: "light" },
  { id: "sunbeam", label: "settings.themeSunbeam", scheme: "light" },
  { id: "sunbeam-pink", label: "settings.themeSunbeamPink", scheme: "light" },
] as const;

export type ThemePreference = (typeof THEME_OPTIONS)[number]["id"];
export type ResolvedTheme = Exclude<ThemePreference, "auto">;

export function isPixelTheme(theme: ThemePreference): boolean {
  return theme === "sunbeam" || theme === "sunbeam-pink";
}

export const SUNBEAM_AVATARS = [
  { id: "fox", label: "settings.avatarFox" },
  { id: "radio", label: "settings.avatarRadio" },
  { id: "sprout", label: "settings.avatarSprout" },
  { id: "orbital", label: "settings.avatarOrbital" },
  { id: "coral", label: "settings.avatarCoral" },
] as const;
export type SunbeamAvatar = (typeof SUNBEAM_AVATARS)[number]["id"];
export const SUNBEAM_AVATAR_STORAGE_KEY = "pi-sunbeam-avatar";

export function isSunbeamAvatar(value: unknown): value is SunbeamAvatar {
  return SUNBEAM_AVATARS.some((avatar) => avatar.id === value);
}

function robotAvatarPosition(identity: string): string {
  let hash = 0;
  for (const char of identity) {
    hash = Math.imul(hash, 31) + char.charCodeAt(0);
  }
  // The first frame in the five-frame Sunbeam sprite is the user's default avatar.
  return `${(((hash >>> 0) % 4) + 1) * 25}%`;
}

export function robotAvatarStyle(identity: string): CSSProperties {
  return { "--chat-avatar-position": robotAvatarPosition(identity) } as CSSProperties;
}

export function subagentAvatarStyle(sessionId: string): CSSProperties {
  return { "--chat-subagent-avatar-position": robotAvatarPosition(`subagent/${sessionId}`) } as CSSProperties;
}

export const LIGHT_THEMES: readonly ResolvedTheme[] = THEME_OPTIONS.flatMap((option) => (option.scheme === "light" ? [option.id] : []));
export const DARK_THEMES: readonly ResolvedTheme[] = THEME_OPTIONS.flatMap((option) => (option.scheme === "dark" ? [option.id] : []));

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_OPTIONS.some((option) => option.id === value);
}

export function isDarkTheme(theme: ResolvedTheme): boolean {
  return DARK_THEMES.includes(theme);
}

// Restore the saved appearance before first paint, including when storage is blocked.
export const THEME_INIT_SCRIPT = `(function() {
  var root = document.documentElement;
  var theme = "auto";
  try {
    var storedTheme = localStorage.getItem("pi-theme");
    if (${JSON.stringify(THEME_OPTIONS.map((option) => option.id))}.includes(storedTheme)) theme = storedTheme;
    var avatar = localStorage.getItem(${JSON.stringify(SUNBEAM_AVATAR_STORAGE_KEY)});
    if (${JSON.stringify(SUNBEAM_AVATARS.map((option) => option.id))}.includes(avatar)) root.dataset.sunbeamAvatar = avatar;
  } catch (error) {}
  if (theme === "auto") theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  root.dataset.theme = theme;
  root.classList.toggle("dark", ${JSON.stringify(DARK_THEMES)}.includes(theme));
})();`;
