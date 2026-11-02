import assert from "node:assert/strict";
import { test } from "node:test";
import { choosePetPlacement, placePet } from "./pet-placement.ts";

const viewport = { x: 0, y: 0, width: 1000, height: 800 };
const size = { width: 200, height: 300 };
const compact = { width: 200, height: 180 };

test("keeps the preferred position when it leaves controls clear", () => {
  const preferred = { x: 500, y: 200 };
  assert.deepEqual(choosePetPlacement(preferred, size, compact, viewport, []).position, preferred);
});

test("moves the shortest distance away from the composer and restores the preference when it leaves", () => {
  const preferred = { x: 600, y: 470 };
  const composer = { x: 300, y: 650, width: 600, height: 150 };
  const placement = choosePetPlacement(preferred, size, compact, viewport, [composer]);
  assert.deepEqual(placement, { position: { x: 600, y: 338 }, compact: false });
  assert.deepEqual(choosePetPlacement(preferred, size, compact, viewport, []).position, preferred);
  assert.deepEqual(preferred, { x: 600, y: 470 });
});

test("finds a free corner when both a dialog and composer occupy the centre", () => {
  const obstacles = [{ x: 200, y: 230, width: 600, height: 310 }, { x: 200, y: 650, width: 600, height: 150 }];
  const placement = placePet({ x: 650, y: 450 }, { width: 160, height: 200 }, viewport, obstacles);
  assert.equal(placement.overlap, 0);
  assert.ok(placement.position.x >= 812 || placement.position.x + 160 <= 188);
});

test("uses a smaller figure only when the full figure has no free position", () => {
  const phone = { x: 0, y: 0, width: 390, height: 700 };
  const obstacles = [{ x: 0, y: 250, width: 390, height: 450 }];
  const placement = choosePetPlacement({ x: 180, y: 350 }, size, compact, phone, obstacles);
  assert.equal(placement.compact, true);
  assert.ok(placement.position.y + compact.height <= 238);
});

test("clamps to the visual viewport including keyboard and viewport offsets", () => {
  const visual = { x: 20, y: 80, width: 390, height: 400 };
  const placement = placePet({ x: 99999, y: 99999 }, compact, visual, []);
  assert.deepEqual(placement.position, { x: 202, y: 292 });
});

test("keeps a safe temporary spot during small resizes and returns when the preference is free", () => {
  const preferred = { x: 600, y: 470 };
  const current = { position: { x: 600, y: 300 }, compact: false };
  const obstacles = [{ x: 300, y: 650, width: 600, height: 150 }];
  assert.deepEqual(choosePetPlacement(preferred, size, compact, viewport, obstacles, current), current);
  assert.deepEqual(choosePetPlacement(preferred, size, compact, viewport, [], current).position, preferred);
});

test("when no free area exists, prioritises keeping the input controls clear", () => {
  const view = { x: 0, y: 0, width: 220, height: 400 };
  const placement = placePet({ x: 10, y: 200 }, compact, view, [
    { x: 0, y: 0, width: 220, height: 200, priority: 1 },
    { x: 0, y: 200, width: 220, height: 200, priority: 3 },
  ]);
  assert.ok(placement.position.y + compact.height <= 188);
});
