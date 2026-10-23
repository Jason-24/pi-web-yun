// Inspect an external, public character creator in a fresh browser context.
// No runtime code from that project is copied into this application.
import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launchPersistentContext("test-results/pet-model-candidate/browser-cache", {
  channel: "msedge", headless: true, viewport: { width: 1400, height: 1000 },
});
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.log("Viewer error:", error.message));
  await page.goto("https://dionysus.dk/webxr/charactercreator/?sex=female&hair=long01&outfit=dress,shoes&anim=idle&cloth=0&view=front&lang=en", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
  await page.evaluate(async () => {
    const values = { skin: "#e5c5b4", hairColor: "#241b19", browColor: "#352824", eyeColor: "#49372d",
      weight: -0.25, muscle: -0.15, proportions: 0.3, noseWidth: -0.25, noseLength: -0.15,
      jawWidth: -0.35, chin: -0.15, eyeSize: 0.15, lips: 0.12, mouthWidth: -0.1, breastPhysics: false };
    for (const [key, value] of Object.entries(values)) await window.__set(key, value);
    await window.__set("clothColor", { id: "dress", primary: "#202026", secondary: "#24242b" });
    await window.__set("clothColor", { id: "shoes", primary: "#19191e", secondary: "#25242b" });
  });
  await page.waitForFunction(() => !window.__hairState().pending && !window.__clothingState().pending);
  await page.screenshot({ path: "test-results/pet-model-candidate/viewer.png" });
  console.log(await page.evaluate(() => ({ values: window.__values?.(), clothing: window.__clothingState?.().outfit })));
  const glb = await page.evaluate(async () => {
    const buffer = await window.__export({ morphs: false, animations: true });
    if (!(buffer instanceof ArrayBuffer)) throw new Error("Unexpected export result");
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
    return btoa(binary);
  });
  await writeFile("test-results/pet-model-candidate/candidate.glb", Buffer.from(glb, "base64"));
  const documentation = await page.request.get("https://raw.githubusercontent.com/kblood/CharacterCreator/master/docs/EXPORT.md");
  await writeFile("test-results/pet-model-candidate/EXPORT.md", await documentation.text());
  console.log("Saved clothed candidate.glb and independent viewer screenshot; the app was not modified.");
} finally { await browser.close(); }
