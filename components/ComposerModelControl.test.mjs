import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const { getReasoningSteps } = await jiti.import("./ComposerModelControl.tsx");

test("reasoning steps keep canonical order and honor sparse model capabilities", () => {
  assert.deepEqual(getReasoningSteps(["high", "off", "low", "max", "unsupported"]), ["low", "high", "max"]);
  assert.deepEqual(getReasoningSteps(["off"]), []);
  assert.deepEqual(getReasoningSteps([]), []);
  assert.deepEqual(getReasoningSteps(["high"]), ["high"]);
});

test("provider-disabled levels stay out of the range without discarding renamed levels", () => {
  assert.deepEqual(getReasoningSteps(["low", "medium", "high", "xhigh"], { medium: null, high: "turbo" }), ["low", "high", "xhigh"]);
  assert.deepEqual(getReasoningSteps(null, { minimal: null, max: null }), ["low", "medium", "high", "xhigh"]);
});
