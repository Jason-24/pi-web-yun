import { getFileName, getRelativeFilePath, normalizeFilePathSlashes } from "@/lib/file-paths";

/** Display-only location: preserve the actual full path in the tooltip. */
export function FileBreadcrumb({ filePath, cwd }: { filePath: string; cwd?: string }) {
  const normalized = normalizeFilePathSlashes(filePath);
  const relative = getRelativeFilePath(normalized, cwd);
  const segments = relative.split("/").filter(Boolean);
  if (cwd && relative !== normalized) segments.unshift(getFileName(cwd));
  else if (normalized.startsWith("/")) segments.unshift(normalized.startsWith("//") ? "//" : "/");
  const name = segments.pop() ?? getFileName(filePath);
  return <div className="file-viewer-path" title={filePath}>
    <div className="file-breadcrumb" role="group" aria-label={filePath}>
      {segments.length > 0 && <span className="file-breadcrumb-parents" aria-hidden="true">
        {segments.map((segment, index) => <span className="file-breadcrumb-segment" key={index}>
          <span>{segment}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 5 7 7-7 7" /></svg>
        </span>)}
      </span>}
      <strong className="file-breadcrumb-current" aria-current="location">{name}</strong>
    </div>
  </div>;
}
