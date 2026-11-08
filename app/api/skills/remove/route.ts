import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";
import { removeInstalledSkill } from "@/lib/skill-remove";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  try {
    const body = await req.json() as { cwd?: unknown; filePath?: unknown; package?: unknown; scope?: unknown; sharedAcknowledged?: unknown };
    if (typeof body.cwd !== "string" || typeof body.filePath !== "string" || typeof body.package !== "string" || (body.scope !== "global" && body.scope !== "project")) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    if (body.sharedAcknowledged !== true) return NextResponse.json({ error: "Confirm the impact on shared skill files" }, { status: 400 });
    const { cwd, filePath, scope } = body;
    if (!isExistingFilePathAllowed(cwd, await getAllowedFileRoots())) return NextResponse.json({ error: "Access denied" }, { status: 403 });
    if (scope === "project" && !getProjectTrustStatus(cwd, getAgentDir()).trusted) return NextResponse.json({ error: "Project is not trusted" }, { status: 403 });
    const { skills } = await loadSkillsWithInstallInfo(cwd, { includeShadowed: true });
    const skill = skills.find((item) => item.filePath === filePath && item.install?.package === body.package && item.install?.scope === scope);
    if (!skill || !skill.install) return NextResponse.json({ error: "Installed skill no longer found; refresh and try again" }, { status: 409 });
    const { backupPath } = await removeInstalledSkill(skill, cwd, getAgentDir());
    let remains: boolean | null = null;
    try { remains = (await loadSkillsWithInstallInfo(cwd, { includeShadowed: true })).skills.some((item) => item.filePath === filePath); } catch { /* Uninstallation succeeded; listing could not be verified. */ }
    return NextResponse.json({ success: true, remains, failed: false, backupPath });
  } catch (error) {
    const detail = error as { stdout?: string; stderr?: string; message?: string };
    return NextResponse.json({ error: (`${detail.stdout ?? ""}${detail.stderr ?? ""}` || detail.message || "Removal failed").slice(-2000) }, { status: 500 });
  }
}
