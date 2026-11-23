import type { ReactNode } from "react";
import { robotAvatarStyle, subagentAvatarStyle } from "@/lib/theme";
import styles from "./AgentAvatar.module.css";

/** Reuse the transcript's sprite and identity mapping without adding a focus target. */
export function AgentAvatar({ identity, subagent = false, fallback }: {
  identity: string;
  subagent?: boolean;
  fallback: ReactNode;
}) {
  return <span className={styles.avatar} aria-hidden="true" data-agent-avatar={subagent ? "subagent" : "main"}
    style={subagent ? subagentAvatarStyle(identity) : robotAvatarStyle(identity)}>{fallback}</span>;
}
