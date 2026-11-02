import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePetName, parsePetPreferences } from "./pet-preferences.ts";

test("preferences recover from absent, malformed or wrongly typed storage", () => {
  for (const raw of [null, "broken", "null", "[]", '{"name":42,"quiet":"yes"}']) {
    assert.deepEqual(parsePetPreferences(raw), { name: "", quiet: false });
  }
  assert.deepEqual(parsePetPreferences('{"name":"  团团  ","quiet":true}'), { name: "团团", quiet: true });
});

test("names stay one line and are bounded by Unicode characters", () => {
  assert.equal(normalizePetName("\n 云\u0000朵\u2028 "), "云朵");
  assert.equal(Array.from(normalizePetName("🌤️".repeat(40))).length, 24);
  assert.equal(normalizePetName("   "), "");
});
