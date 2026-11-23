import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { DARK_THEMES, LIGHT_THEMES, SUNBEAM_AVATARS, SUNBEAM_AVATAR_STORAGE_KEY, THEME_INIT_SCRIPT, THEME_OPTIONS, isDarkTheme, isSunbeamAvatar, isThemePreference } from "./theme.ts";

test("first paint restores every palette and falls back to the system for invalid or blocked storage", () => {
  for (const systemDark of [false, true]) {
    for (const stored of [...THEME_OPTIONS.map(({ id }) => id), null, "", "unknown", new Error("Blocked")]) {
      const root = { dataset: {}, classList: { toggle: (name, value) => { root[name] = value; } } };
      runInNewContext(THEME_INIT_SCRIPT, {
        localStorage: { getItem: () => { if (stored instanceof Error) throw stored; return stored; } },
        window: { matchMedia: () => ({ matches: systemDark }) },
        document: { documentElement: root },
      });
      const expected = isThemePreference(stored) && stored !== "auto" ? stored : systemDark ? "dark" : "light";
      assert.equal(root.dataset.theme, expected);
      assert.equal(root.dark, isDarkTheme(expected));
    }
  }
});

test("first paint restores only built-in Sunbeam avatars", () => {
  for (const avatar of [...SUNBEAM_AVATARS.map(({ id }) => id), null, "unknown", new Error("Blocked")]) {
    const root = { dataset: {}, classList: { toggle() {} } };
    runInNewContext(THEME_INIT_SCRIPT, {
      localStorage: { getItem(key) {
        if (key !== SUNBEAM_AVATAR_STORAGE_KEY) return "sunbeam";
        if (avatar instanceof Error) throw avatar;
        return avatar;
      } },
      document: { documentElement: root },
    });
    assert.equal(root.dataset.theme, "sunbeam");
    assert.equal(root.dataset.sunbeamAvatar, isSunbeamAvatar(avatar) ? avatar : undefined);
  }
});

test("every palette belongs to exactly one of the light and dark sets", () => {
  const palettes = THEME_OPTIONS.map(({ id }) => id).filter((id) => id !== "auto");
  assert.deepEqual([...LIGHT_THEMES, ...DARK_THEMES].sort(), [...palettes].sort());
  assert.equal(LIGHT_THEMES.some((id) => DARK_THEMES.includes(id)), false);
  assert.ok(LIGHT_THEMES.includes("light") && DARK_THEMES.includes("dark"));
});
