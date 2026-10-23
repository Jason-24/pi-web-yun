// Slice the ImageGen atlas and align all poses by their feet without changing its alpha.
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const source = process.argv[2];
if (!source) throw new Error("Usage: node scripts/prepare-pet-sprites.mjs <generated-atlas.png>");
const destination = resolve("public/pets/lin-yue");
await mkdir(destination, { recursive: true });
const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const cellWidth = info.width / 3;
const cellHeight = info.height / 2;
const poses = ["idle", "wave", "happy", "thinking", "cheer", "sleep"];
for (const [index, pose] of poses.entries()) {
  const column = index % 3;
  const row = Math.floor(index / 3);
  let left = cellWidth, top = cellHeight, right = 0, bottom = 0;
  const alpha = (x, y) => data[((row * cellHeight + y) * info.width + column * cellWidth + x) * 4 + 3];
  for (let y = 0; y < cellHeight; y++) {
    for (let x = 0; x < cellWidth; x++) {
      if (alpha(x, y) <= 128) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  let footX = 0, weight = 0;
  for (let y = bottom - 18; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      if (alpha(x, y) <= 128) continue;
      footX += x; weight++;
    }
  }
  left = Math.max(0, left - 6); top = Math.max(0, top - 6);
  right = Math.min(cellWidth - 1, right + 6); bottom = Math.min(cellHeight - 1, bottom + 4);
  const sprite = await sharp(source).extract({
    left: column * cellWidth + left, top: row * cellHeight + top,
    width: right - left + 1, height: bottom - top + 1,
  }).png().toBuffer();
  await sharp({ create: { width: 280, height: 536, channels: 4, background: "#00000000" } })
    .composite([{ input: sprite, left: Math.round(140 - (footX / weight - left)), top: 520 - (bottom - top) }])
    .webp({ quality: 92, alphaQuality: 100 }).toFile(resolve(destination, `${pose}.webp`));
}
console.log(`Prepared ${poses.length} transparent sprites in ${destination}`);
