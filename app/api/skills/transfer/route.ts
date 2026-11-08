import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { loadSkillsWithInstallInfo } from "@/lib/skills-service";
import { previewSkillTransfer, SkillTransferError, transferInstalledSkill, undoSkillTransfer } from "@/lib/skill-transfer";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ code: "access-denied" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ code: "invalid-request" }, { status: 415 });
  try {
    const body = await req.json() as Record<string, unknown>;
    if (typeof body.cwd !== "string" || !["preview", "apply", "undo"].includes(String(body.action))) return NextResponse.json({ code: "invalid-request" }, { status: 400 });
    const cwd = body.cwd;
    if (!isExistingFilePathAllowed(cwd, await getAllowedFileRoots())) return NextResponse.json({ code: "access-denied" }, { status: 403 });
    const agentDir = getAgentDir();
    // Both directions read or write the project's resource directory.
    if (!getProjectTrustStatus(cwd, agentDir).trusted) return NextResponse.json({ code: "project-untrusted" }, { status: 403 });
    if (body.action === "undo") {
      if (typeof body.undoToken !== "string") return NextResponse.json({ code: "invalid-request" }, { status: 400 });
      return NextResponse.json(await undoSkillTransfer(body.undoToken, cwd));
    }
    if (typeof body.filePath !== "string" || typeof body.package !== "string") return NextResponse.json({ code: "invalid-request" }, { status: 400 });
    const { skills } = await loadSkillsWithInstallInfo(cwd, { includeShadowed: true });
    const skill = skills.find((item) => item.filePath === body.filePath && item.install?.package === body.package);
    if (!skill?.install) return NextResponse.json({ code: "source-changed" }, { status: 409 });
    if (body.action === "preview") return NextResponse.json(await previewSkillTransfer(skill, cwd, agentDir));
    if ((body.mode !== "move" && body.mode !== "copy") || body.sharedAcknowledged !== true) return NextResponse.json({ code: "invalid-request" }, { status: 400 });
    return NextResponse.json(await transferInstalledSkill(skill, body.mode, cwd, agentDir));
  } catch (error) {
    if (error instanceof SkillTransferError) return NextResponse.json({ code: error.code, targetPath: error.targetPath }, { status: 409 });
    if (error instanceof Error && error.message.startsWith("Linked skill roots")) return NextResponse.json({ code: "linked-files" }, { status: 409 });
    return NextResponse.json({ code: "failed", details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
