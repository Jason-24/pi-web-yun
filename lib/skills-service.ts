import { DefaultResourceLoader, getAgentDir, loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import type { SkillInfo, SkillsResponse } from "@/lib/api-types";
import { annotateSkillsWithInstallInfo } from "@/lib/skill-lock";
import { getProjectTrustStatus, projectTrustReloadOptions } from "@/lib/project-trust";

export async function loadSkillsWithInstallInfo(cwd: string, options: { includeShadowed?: boolean } = {}): Promise<SkillsResponse> {
  const agentDir = getAgentDir();
  // Extensions add skills only through `resources_discover` at session_start,
  // which a listing never runs, so loading them here would only import every
  // extension for nothing (#1226).
  const loader = new DefaultResourceLoader({ cwd, agentDir, noExtensions: true });
  await loader.reload(projectTrustReloadOptions(cwd, agentDir));
  const { skills, diagnostics } = loader.getSkills();
  const listed = (skills as SkillInfo[]).map((skill) => ({ ...skill, loaded: true }));
  if (options.includeShadowed) {
    // Only inspect paths already reported by the trusted SDK loader. Keep the
    // runtime catalog unchanged; this superset is solely for management.
    for (const diagnostic of diagnostics) {
      const collision = diagnostic.collision;
      if (collision?.resourceType !== "skill" || listed.some((skill) => skill.filePath === collision.loserPath)) continue;
      const found = loadSkillsFromDir({ dir: path.dirname(collision.loserPath), source: collision.loserSource ?? "path" }).skills.find((skill) => skill.filePath === collision.loserPath);
      if (found) listed.push({ ...found, loaded: false });
    }
  }
  return {
    skills: annotateSkillsWithInstallInfo(listed, { cwd, agentDir }),
    diagnostics,
    projectResourcesLoaded: getProjectTrustStatus(cwd, agentDir).trusted,
  };
}
