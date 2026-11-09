import assert from "node:assert/strict";
import { chromium } from "playwright";
import { openSettings } from "./settings.mjs";

const browser = await chromium.launch({ headless: true, channel: process.env.E2E_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: "en-US", reducedMotion: "reduce" });
const page = await context.newPage();
let selected = { provider: "relay", modelId: "first" };
let thinking = "medium";
let failure = false;
let authFailure = true;
let emptyModels = false;
const writes = [];
await context.addInitScript(() => localStorage.setItem("pi-locale", "en"));
await context.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/api/models/default" && route.request().method() === "PUT") {
    writes.push(route.request().postDataJSON());
    if (failure) return route.fulfill({ status: 409, json: { error: "Project overrides the default" } });
    if (writes.at(-1).thinkingLevel) thinking = writes.at(-1).thinkingLevel;
    else selected = { provider: writes.at(-1).provider, modelId: writes.at(-1).modelId };
    return route.fulfill({ json: { ok: true } });
  }
  if (path === "/api/models") return route.fulfill({ json: { modelList: emptyModels ? [] : [{ provider: "relay", id: "first", name: "First" }, { provider: "relay", id: "second", name: "Second" }], defaultModel: selected, savedDefaultThinkingLevel: thinking, models: {} } });
  if (path === "/api/models-config" && route.request().method() === "PUT") return route.fulfill({json:{success:true}});
  if (path === "/api/models-config") return route.fulfill({ json: { providers: { relay: { models: [{ id: "first" }, { id: "second" }] } } } });
  if (path === "/api/auth/providers") return authFailure
    ? route.fulfill({status:500,json:{error:"Provider read failure"}})
    : route.fulfill({json:{oauthProviders:[],apiKeyProviders:[{id:"deepseek",displayName:"DeepSeek",configured:true,modelCount:2}]}});
  if (path === "/api/models/enabled") return route.fulfill({ json: { allEnabled: true, patterns: null, stalePatterns: [], enabledTotal: 2, availableTotal: 2, scope: "global", editable: true, providers: [] } });
  if (path === "/api/sessions") return route.fulfill({ json: { sessions: [], runningSessionIds: [], awaitingInputSessionIds: [] } });
  if (path === "/api/sessions/ui-state") return route.fulfill({ json: { state: { version: 1, revision: 1, sessions: {}, projects: {} } } });
  if (path === "/api/home") return route.fulfill({ json: { home: "C:/Users/test" } });
  return route.fulfill({ json: {} });
});
try {
 await page.goto(`${process.env.E2E_URL || "http://127.0.0.1:30141"}/`,{waitUntil:"domcontentloaded",timeout:120000});
 await page.getByRole('button',{name:'Open project',exact:true}).waitFor();
 await page.waitForTimeout(1000);
 const settings=await openSettings(page,'Models');
 const notice=settings.locator('.models-load-notice');
 await notice.waitFor();
 authFailure=false;
 await notice.getByRole('button',{name:'Refresh',exact:true}).click();
 await notice.waitFor({state:'detached'});
 const deepseek=settings.locator('.config-sidebar-item').filter({hasText:/^DeepSeek$/});
 await deepseek.click();
 authFailure=true;
 await settings.locator('.config-detail input[type=password]').fill('fixture-only-key');
 await settings.locator('.config-detail').getByRole('button',{name:'Save',exact:true}).click();
 await notice.waitFor();
 assert.equal(await deepseek.count(),1,'A failed refresh preserves the loaded provider');
 authFailure=false;
 await notice.getByRole('button',{name:'Refresh',exact:true}).click();
 await notice.waitFor({state:'detached'});
 await settings.locator('.config-sidebar-item').filter({hasText:/^relay$/}).click();
 const baseUrl=settings.locator(".config-field-label").filter({hasText:/^Base URL$/}).locator("..").locator("input");
 await baseUrl.fill('https://fixture.invalid/v1');
 const footer=settings.locator('.config-footer');
 await footer.getByText(/Unsaved changes/).waitFor();
 emptyModels=true;
 await footer.getByRole('button',{name:'Save',exact:true}).click();
 await footer.getByRole('button',{name:'Saved',exact:true}).waitFor();
 await baseUrl.fill('https://fixture.invalid/v2');
 await footer.getByText(/Unsaved changes/).waitFor();
 assert.equal(await footer.getByRole('button',{name:'Save',exact:true}).isEnabled(),true,'Editing after Save immediately enables Save');
 await settings.locator('.model-defaults-toggle').click();
 await settings.getByText('No models are available. Configure a provider first, then try again.',{exact:true}).waitFor();
 await settings.locator('.model-defaults-empty').getByRole('button',{name:'Add provider',exact:true}).click();
 await page.getByRole('dialog').waitFor();
 console.log('PASS: initial error recovery, preserved provider list, dirty/saved edits, and actionable empty defaults.');
} finally {await browser.close();}
