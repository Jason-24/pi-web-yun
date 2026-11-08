import type { McpScope } from "./api-types";
import type { PiSdkInternals } from "./pi-sdk-internals";
import { canonicalJson, mcpConfigKey } from "./mcp-config-key";
import { editMcpConfigFile, ownServerEntry, type McpConfigFileTarget } from "./mcp-config-file";
import { literalSecretFields, maskArgs, maskCommand, maskUrl } from "./mcp-secrets";
import { findWebPasswordField } from "./mcp-transport";

export interface McpEditField { value: string; hidden: boolean }
export interface McpEditData {
  version: string;
  transport: "http" | "stdio";
  fields: Record<string, McpEditField>;
  names: string[];
}
export interface McpEditPatch {
  fields?: Record<string, string>;
  values?: { name: string; action: "remove" | "literal" | "reference"; value?: string }[];
}
export class McpEditError extends Error {
  constructor(readonly reason: "invalid-request" | "server-invalid" | "config-changed" | "server-missing" | "web-password" | "secret-global-only", message: string) { super(message); }
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function entry(value: unknown): Record<string, unknown> {
  if (!record(value) || (typeof value.url !== "string" && typeof value.command !== "string")) {
    throw new McpEditError("server-invalid", "Only full HTTP or stdio server entries can be edited");
  }
  return value;
}

/** File values are never resolved; hidden fields and all env/header values stay server-side. */
export function mcpEditData(value: unknown): McpEditData {
  const config = entry(value);
  const http = typeof config.url === "string";
  const fields: McpEditData["fields"] = {};
  for (const name of http ? ["description", "url"] : ["description", "command", "args", "cwd"]) {
    const raw = config[name];
    const hidden = name === "url" ? maskUrl(String(raw ?? "")).masked
      : name === "command" ? maskCommand(String(raw ?? "")).masked
        : name === "args" && Array.isArray(raw) ? maskArgs(raw.filter((arg): arg is string => typeof arg === "string")).masked : false;
    Object.defineProperty(fields, name, { enumerable: true, value: { hidden, value: hidden ? "" : name === "args" ? JSON.stringify(raw ?? [], null, 2) : String(raw ?? "") } });
  }
  const values = config[http ? "headers" : "env"];
  return { version: mcpConfigKey(config), transport: http ? "http" : "stdio", fields, names: record(values) ? Object.keys(values) : [] };
}

export function applyMcpEdit(value: unknown, patch: unknown, scope: McpScope, name: string, internals: PiSdkInternals): Record<string, unknown> {
  const current = entry(value);
  if (!record(patch) || Object.keys(patch).some((key) => key !== "fields" && key !== "values")) throw new McpEditError("invalid-request", "Invalid edit patch");
  const next = { ...current };
  const http = typeof current.url === "string";
  if (patch.fields !== undefined) {
    if (!record(patch.fields)) throw new McpEditError("invalid-request", "Invalid fields");
    const allowed = http ? ["description", "url"] : ["description", "command", "args", "cwd"];
    for (const [key, text] of Object.entries(patch.fields)) {
      if (!allowed.includes(key) || typeof text !== "string" || text.length > 65536) throw new McpEditError("invalid-request", "Invalid field");
      if (key === "args") {
        let args: unknown;
        try { args = JSON.parse(text); } catch { throw new McpEditError("invalid-request", "Arguments must be a JSON array of strings"); }
        if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) throw new McpEditError("invalid-request", "Arguments must be a JSON array of strings");
        next.args = args;
      } else if ((key === "cwd" || key === "description") && text === "") delete next[key];
      else next[key] = text;
    }
  }
  if (patch.values !== undefined) {
    if (!Array.isArray(patch.values) || patch.values.length > 200) throw new McpEditError("invalid-request", "Invalid values");
    const key = http ? "headers" : "env";
    const values = record(current[key]) ? { ...current[key] } : {};
    const seen = new Set<string>();
    for (const change of patch.values) {
      if (!record(change) || typeof change.name !== "string" || !change.name || change.name.length > 1024 || seen.has(change.name)) throw new McpEditError("invalid-request", "Value names must be nonempty and unique");
      seen.add(change.name);
      if (change.action === "remove") { delete values[change.name]; continue; }
      if (typeof change.value !== "string" || change.value.length > 65536) throw new McpEditError("invalid-request", "Invalid replacement value");
      let replacement: string;
      if (change.action === "reference") {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(change.value)) throw new McpEditError("invalid-request", "Invalid variable name");
        replacement = "${" + change.value + "}";
      } else if (change.action === "literal") {
        // A typed literal must never become a host command or variable expansion.
        replacement = change.value.replace(/\$/g, "$$$$").replace(/^!/, "$!");
      } else throw new McpEditError("invalid-request", "Invalid value action");
      Object.defineProperty(values, change.name, { value: replacement, enumerable: true, configurable: true, writable: true });
    }
    if (patch.values.length > 0) next[key] = values;
  }
  if (typeof internals.validateMcpServerConfig(name, next) === "string") throw new McpEditError("server-invalid", "The edited configuration is not valid");
  if (findWebPasswordField(next, internals)) throw new McpEditError("web-password", "PI_WEB_PASSWORD cannot be used in MCP configuration");
  if (scope === "project" && (http && Object.hasOwn(next, "auth"))) throw new McpEditError("server-invalid", "Project HTTP servers cannot use provider authentication");
  if (scope === "project" && literalSecretFields(next).length > 0) throw new McpEditError("secret-global-only", "Use variable references for secrets in project configuration");
  return next;
}

/** Compare the raw entry under the same lock as the write, retaining all untouched fields. */
export function updateMcpEntry(target: McpConfigFileTarget, name: string, version: string, patch: unknown, internals: PiSdkInternals) {
  return editMcpConfigFile(target, ({ servers }) => {
    const current = ownServerEntry(servers, name);
    if (current === undefined) throw new McpEditError("server-missing", "The server no longer exists");
    if (mcpConfigKey(current) !== version) throw new McpEditError("config-changed", "The configuration changed; reload before saving");
    const next = applyMcpEdit(current, patch, target.scope, name, internals);
    Object.defineProperty(servers!, name, { value: next, enumerable: true, writable: true, configurable: true });
    return { changed: canonicalJson(current) !== canonicalJson(next), value: undefined };
  });
}
