"use client";

import { useEffect, useRef, useState } from "react";
import type { McpServerInfo } from "@/lib/api-types";
import type { McpEditData, McpEditPatch } from "@/lib/mcp-edit";
import { useI18n } from "@/hooks/useI18n";
import { revealHiddenCharacters } from "@/lib/mcp-server-display";
import { ConfigButton, ConfigScopeTag } from "./SettingsUi";

type ValueRow = { id: number; name: string; existing: boolean; action: "keep" | "literal" | "reference" | "remove"; value: string };

export function McpServerEditor({ server, cwd, onCancel, onSaved }: {
  server: McpServerInfo; cwd: string | null; onCancel: () => void; onSaved: () => void;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<McpEditData | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<ValueRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nextId = useRef(0);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const errorText = (reason: string) => t(`mcp.edit.error.${reason}`);
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    const controller = new AbortController();
    request.current = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    fetch("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read-edit", scope: server.scope, name: server.name, ...(cwd ? { cwd } : {}) }), signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.reason ?? "internal");
        if (disposed || controller.signal.aborted) return;
        setData(result);
        setRows(result.names.map((name: string) => ({ id: nextId.current++, name, existing: true, action: "keep", value: "" })));
      }).catch((failure) => { if (!disposed) setError(failure.name === "AbortError" ? "network" : failure.message); })
      .finally(() => clearTimeout(timer));
    return () => { disposed = true; mounted.current = false; controller.abort(); request.current?.abort(); };
  }, [server.scope, server.name, cwd]);

  const invalid = rows.some((row, index) => row.action !== "remove" && (!row.name.trim() || rows.some((other, otherIndex) => otherIndex !== index && other.name === row.name)))
    || rows.some((row) => row.action === "reference" && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(row.value));
  const changed = Object.keys(fields).length > 0 || rows.some((row) => row.action !== "keep");
  const save = async () => {
    if (!data || saving || invalid || !changed) return;
    const patch: McpEditPatch = { fields, values: rows.filter((row) => row.action !== "keep").map((row) => ({ name: row.name, action: row.action as "remove" | "literal" | "reference", ...(row.action !== "remove" ? { value: row.value } : {}) })) };
    setSaving(true); setError(null);
    const controller = new AbortController(); request.current = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update", scope: server.scope, name: server.name, version: data.version, patch, ...(cwd ? { cwd } : {}) }), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.reason ?? "internal");
      if (mounted.current) onSaved();
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error && failure.name !== "AbortError" ? failure.message : "network");
    } finally { clearTimeout(timer); if (mounted.current) setSaving(false); }
  };
  const updateRow = (id: number, change: Partial<ValueRow>) => setRows((current) => current.map((row) => row.id === id ? { ...row, ...change } : row));
  return <section className="mcp-edit" aria-label={t("mcp.edit.title")}>
    <header className="mcp-edit-heading"><div><ConfigScopeTag scope={server.scope}>{t(server.scope === "global" ? "skills.scope.global" : "skills.scope.project")}</ConfigScopeTag><h3>{t("mcp.edit.title")} · {revealHiddenCharacters(server.name)}</h3></div></header>
    <p className="mcp-edit-hint">{t("mcp.edit.hint")}</p>
    <p className="mcp-edit-path">{server.sourcePath}</p>
    {error && <p role="alert" className="mcp-config-line is-error">{["config-changed", "invalid-request", "server-invalid", "secret-global-only", "network"].includes(error) ? errorText(error) : t(`mcp.reason.${error}`)}</p>}
    {!data && !error && <p>{t("i18n.loading")}</p>}
    {data && <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset disabled={saving}>
        {Object.entries(data.fields).map(([name, field]) => {
          const replacing = Object.hasOwn(fields, name);
          const value = replacing ? fields[name] : field.value;
          return <div className="mcp-edit-field" key={name}>
            <label htmlFor={`mcp-edit-${name}`}>{t(`mcp.edit.field.${name}`)}</label>
            {field.hidden && <label className="mcp-edit-replace"><input type="checkbox" checked={replacing} onChange={(event) => setFields((current) => { const next = { ...current }; if (event.target.checked) next[name] = ""; else delete next[name]; return next; })} />{t("mcp.edit.replaceHidden")}</label>}
            {(!field.hidden || replacing) && (name === "args" || name === "description" ? <textarea id={`mcp-edit-${name}`} rows={name === "description" ? 3 : 4} value={value} spellCheck={name === "description"} onChange={(event) => setFields({ ...fields, [name]: event.target.value })} /> : <input id={`mcp-edit-${name}`} value={value} autoComplete="off" spellCheck={false} onChange={(event) => setFields({ ...fields, [name]: event.target.value })} />)}
            {name === "args" && <span className="mcp-edit-hint">{t("mcp.edit.argsHint")}</span>}
          </div>;
        })}
        <div className="mcp-edit-values-heading"><h4>{t(data.transport === "http" ? "mcp.detail.headers" : "mcp.detail.env")}</h4><ConfigButton size="small" onClick={() => setRows([...rows, { id: nextId.current++, name: "", existing: false, action: "literal", value: "" }])}>{t("mcp.edit.addValue")}</ConfigButton></div>
        <div className="mcp-edit-values">{rows.map((row) => <div className="mcp-edit-value" key={row.id}>
          <input aria-label={t("mcp.edit.valueName")} placeholder={t("mcp.edit.valueName")} value={row.name} readOnly={row.existing} onChange={(event) => updateRow(row.id, { name: event.target.value })} />
          <select aria-label={t("mcp.edit.valueAction", { name: revealHiddenCharacters(row.name) })} value={row.action} onChange={(event) => updateRow(row.id, { action: event.target.value as ValueRow["action"], value: "" })}>
            {row.existing && <option value="keep">{t("mcp.edit.keep")}</option>}
            <option value="literal">{t("mcp.edit.literal")}</option><option value="reference">{t("mcp.edit.reference")}</option>
            {row.existing && <option value="remove">{t("mcp.edit.remove")}</option>}
          </select>
          {(row.action === "literal" || row.action === "reference") && <input type={row.action === "literal" ? "password" : "text"} autoComplete="new-password" aria-label={t("mcp.edit.value", { name: revealHiddenCharacters(row.name) })} placeholder={t(row.action === "reference" ? "mcp.edit.variableName" : "mcp.edit.newValue")} value={row.value} onChange={(event) => updateRow(row.id, { value: event.target.value })} />}
          {!row.existing && <ConfigButton size="small" onClick={() => setRows(rows.filter((item) => item.id !== row.id))}>{t("i18n.remove")}</ConfigButton>}
        </div>)}</div>
        {invalid && <p className="mcp-edit-hint">{t("mcp.edit.valuesInvalid")}</p>}
        <footer className="mcp-edit-footer"><ConfigButton onClick={onCancel}>{t("i18n.cancel")}</ConfigButton><ConfigButton type="submit" disabled={!changed || invalid}>{t(saving ? "mcp.edit.saving" : "mcp.edit.save")}</ConfigButton></footer>
      </fieldset>
    </form>}
    {!data && <ConfigButton onClick={onCancel}>{t("i18n.cancel")}</ConfigButton>}
  </section>;
}
