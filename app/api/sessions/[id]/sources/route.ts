import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";
import { openSessionManager, resolveSessionPath } from "@/lib/session-reader";
import { isValidSessionId } from "@/lib/session-file-references-core";
import { collectOverviewSources, readOverviewImage } from "@/lib/session-overview";
import { getBase64DecodedByteLength, MAX_ATTACHED_IMAGE_BYTES } from "@/lib/image-attachments";
import type { SessionEntry } from "@/lib/types";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const imageKey = url.searchParams.get("image");
  if (!isValidSessionId(id)) return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  const imageMatch = imageKey?.match(/^([a-zA-Z0-9_-]+):(\d+)$/);
  if (imageKey !== null && !imageMatch) return NextResponse.json({ error: "Invalid image" }, { status: 400 });
  try {
    const rpc = getRpcSession(id);
    const live = rpc?.isAlive() ? rpc : undefined;
    const path = live ? null : await resolveSessionPath(id);
    if (!live && !path) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const sm = live?.inner.sessionManager ?? openSessionManager(path!);
    const leaf = url.searchParams.get("leafId") ?? sm.getLeafId();
    if (leaf && !sm.getEntry(leaf)) return NextResponse.json({ error: "Branch not found" }, { status: 404 });
    const branch = sm.getBranch(leaf ?? undefined) as unknown as SessionEntry[];
    if (imageMatch) {
      const entry = branch.find(item => item.id === imageMatch[1]);
      const blockIndex = Number(imageMatch[2]);
      if (!Number.isSafeInteger(blockIndex) || !entry || entry.type !== "message" || entry.message.role !== "user" || !Array.isArray(entry.message.content)) {
        return NextResponse.json({ error: "Image not found" }, { status: 404 });
      }
      const image = readOverviewImage(entry.message.content[blockIndex]);
      if (!image) return NextResponse.json({ error: "Image not found" }, { status: 404 });
      const size = getBase64DecodedByteLength(image.data);
      if (size === null || size > MAX_ATTACHED_IMAGE_BYTES) return NextResponse.json({ error: "Invalid image data" }, { status: 413 });
      const bytes = new Uint8Array(Buffer.from(image.data, "base64"));
      return new Response(bytes.buffer, { headers: { "Content-Type": image.mime, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600" } });
    }
    return NextResponse.json(collectOverviewSources(branch, sm.getHeader()?.cwd ?? ""), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not read conversation sources" }, { status: 500 });
  }
}
