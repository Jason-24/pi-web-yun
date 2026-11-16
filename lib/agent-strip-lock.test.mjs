import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { loadAgentStripLocked, saveAgentStripLocked } = await jiti.import("./agent-strip-lock.ts");

function memoryStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  };
}

test("the Agents strip starts unlocked, and its lock survives a reload", () => {
  const storage = memoryStorage();
  assert.equal(loadAgentStripLocked(storage), false);
  saveAgentStripLocked(true, storage);
  assert.equal(loadAgentStripLocked(storage), true);
});

test("the strip lock leaves the retired minimap preference untouched", () => {
  const storage = memoryStorage();
  storage.setItem("pi-web:minimap-preview-locked", "1");
  saveAgentStripLocked(true, storage);
  saveAgentStripLocked(false, storage);
  assert.equal(storage.getItem("pi-web:minimap-preview-locked"), "1");
  assert.equal(loadAgentStripLocked(storage), false);
});
