// Local companion dialogue only; no chat content or model requests are involved.
const replyGroups: Record<string, readonly string[]> = Object.fromEntries([
  "welcome", "helloReply", "cheerReply", "sleepReply", "wakeReply", "greetRun",
  "received", "replying", "working", "attention", "backToYou", "greetDone", "stopped", "failed",
].map((name) => [`pet.${name}`, [`pet.${name}`, `pet.${name}2`, `pet.${name}3`]]));
replyGroups["pet.patReply1"] = ["pet.patReply1", "pet.patReply2", "pet.patReply3", "pet.patReply4"];

export function createPetReplyPicker() {
  const remaining = new Map<string, string[]>();
  const previous = new Map<string, string>();
  return (key: string): string => {
    const choices = replyGroups[key];
    if (!choices) return key;
    let bag = remaining.get(key);
    if (!bag?.length) {
      bag = [...choices];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      // Avoid repeating even across the boundary between two shuffled bags.
      if (bag[bag.length - 1] === previous.get(key)) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
      remaining.set(key, bag);
    }
    const next = bag.pop()!;
    previous.set(key, next);
    return next;
  };
}
