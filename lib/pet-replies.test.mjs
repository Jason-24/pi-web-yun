import assert from "node:assert/strict";
import { test } from "node:test";
import { createPetReplyPicker } from "./pet-replies.ts";

test("dialogue visits every reply before reuse and never repeats at cycle boundaries", () => {
  const pick = createPetReplyPicker();
  for (const [key, size] of [["pet.patReply1", 4], ["pet.helloReply", 3], ["pet.greetDone", 3]]) {
    let previous;
    for (let cycle = 0; cycle < 30; cycle++) {
      const lines = [];
      for (let i = 0; i < size; i++) {
        const line = pick(key);
        assert.notEqual(line, previous);
        previous = line;
        lines.push(line);
      }
      assert.equal(new Set(lines).size, size);
    }
  }
  assert.equal(pick("pet.status.idle"), "pet.status.idle");
});
