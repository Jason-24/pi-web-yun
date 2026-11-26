import type { ReactNode } from "react";

/**
 * Small stroke icons for the session sidebar: rows, group headers, menus and
 * the files tab. One 24 grid, stroked with `currentColor`, so the parent's
 * color (muted, dim, accent, danger) decides how they look. Decorative by
 * default (`aria-hidden`); pass `label` when the icon is the only thing that
 * says what it means (the running spinner in a row's status slot).
 */
export interface SidebarIconProps {
  /** Rendered width and height in px. */
  size?: number;
  className?: string;
  /** Accessible name; makes the icon an image instead of decoration. */
  label?: string;
}

/** Two collaborators, shared by the workspace rail and Agents settings. */
export function AgentsIcon({ strokeWidth = 1.7, ...props }: SidebarIconProps & { strokeWidth?: number }) {
  return <SidebarIcon {...props} strokeWidth={strokeWidth}
    pixelPath="M2 1h3v1h1v3H5v1H2V5H1V2h1ZM2 7h3v1h1v1h1v2H0V9h1V8h1ZM8 2h2v1h1v2h-1v1H8V5H7V3h1ZM9 7h2v1h1v3H8V9H7V8h2Z">
    <circle cx="9" cy="8" r="3" />
    <path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 5.2a3 3 0 0 1 0 5.6M18 14.2a4 4 0 0 1 3 3.8v2" />
  </SidebarIcon>;
}

export function HistoryIcon({ strokeWidth = 1.7, ...props }: SidebarIconProps & { strokeWidth?: number }) {
  return <SidebarIcon {...props} strokeWidth={strokeWidth}
    pixelPath="M5 0h4v1h1v1h1v2h1v4h-1v2h-1v1H8v1H4v-1H2v-1H1V8h1v1h1v1h2v1h3v-1h1V9h1V8h1V4h-1V3H9V2H8V1H5v1H4v1H3v1h2v1H0V0h1v3h1V2h1V1h2ZM6 3h1v3h2v1H6Z">
    <path d="M4 8a8.5 8.5 0 1 1-1 4" />
    <path d="M4 3.5V8h4.5M12 7.5v5l3.5 2" />
  </SidebarIcon>;
}

function SidebarIcon({ size = 13, className, label, strokeWidth = 2, pixelPath, children }: SidebarIconProps & {
  strokeWidth?: number;
  /** Filled alternate glyph on a 12×12 grid. The Pixel sidebar selects it in CSS. */
  pixelPath?: string;
  children: ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {children}
      {pixelPath && <path className="sidebar-icon-pixel" d={pixelPath} transform="scale(2)" fill="currentColor"
        fillRule="evenodd" stroke="none" shapeRendering="crispEdges" display="none" />}
    </svg>
  );
}

export function PlusIcon(props: SidebarIconProps) {
  return <SidebarIcon {...props} pixelPath="M5 2h2v3h3v2H7v3H5V7H2V5h3Z"><path d="M12 5v14M5 12h14" /></SidebarIcon>;
}

export function HomeIcon(props: SidebarIconProps) {
  return <SidebarIcon {...props}><path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2Z" fill="currentColor" strokeWidth="1.4" /></SidebarIcon>;
}

/** Horizontal dots: the "⋯" of a row or group. */
export function MoreIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props} pixelPath="M1 5h2v2H1ZM5 5h2v2H5ZM9 5h2v2H9Z">
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </SidebarIcon>
  );
}

export function ArchiveIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props} pixelPath="M1 1h10v4h-1v6H2V5H1ZM2 2v2h8V2ZM3 5v5h6V5ZM5 6h2v1H5Z">
      <rect x="3" y="4" width="18" height="5" rx="1" />
      <path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9" />
      <path d="M10 13h4" />
    </SidebarIcon>
  );
}

export function RestoreIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </SidebarIcon>
  );
}

export function PinIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <path d="M12 17v5" />
      <path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9a2 2 0 0 1-1.1-1.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </SidebarIcon>
  );
}

export function PinOffIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <path d="M12 17v5" />
      <path d="M15 9.3V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8.5" />
      <path d="m2 2 20 20" />
      <path d="M9 9v1.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h11" />
    </SidebarIcon>
  );
}

/**
 * Points right; a class on it turns it down for an expanded section. Section
 * headers pass `strokeWidth={3}`: at their 12px that is a 1.5px line, as
 * firm as their bold label. Elsewhere (menus, the archive's Back, the
 * pickers) it keeps the stroke of the icons beside it.
 */
export function ChevronIcon({ strokeWidth, ...props }: SidebarIconProps & { strokeWidth?: number }) {
  return <SidebarIcon {...props} strokeWidth={strokeWidth} pixelPath="M4 2h2v1h1v1h1v1h1v2H8v1H7v1H6v1H4V8h1V7h1V5H5V4H4Z"><path d="m9 6 6 6-6 6" /></SidebarIcon>;
}

export function BranchIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </SidebarIcon>
  );
}

export function ConversationBranchesIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props} strokeWidth={1.7}>
      <path d="M14.5 7V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2v2l2.5-2" />
      <path d="M11 9h8a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2v2.5L16.5 18H11a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z" />
      <path d="M12 13.5h5.5" />
    </SidebarIcon>
  );
}

/** Two branches from one stem: a row's "Fork" (BranchIcon stands for a worktree's branch). */
export function ForkIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <circle cx="6" cy="5" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="12" cy="19" r="2.5" />
      <path d="M6 7.5v1.5a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7.5" />
      <path d="M12 12v4.5" />
    </SidebarIcon>
  );
}

/** An arrow leaving a box: a session row's "Open in new tab" (a browser tab, not a copy). */
export function OpenInNewTabIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </SidebarIcon>
  );
}

export function TrashIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <path d="M3 6h18" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </SidebarIcon>
  );
}

export function PencilIcon(props: SidebarIconProps) {
  return <SidebarIcon {...props}><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></SidebarIcon>;
}

/** Filled dot: "mark as unread". */
export function DotIcon(props: SidebarIconProps) {
  return <SidebarIcon {...props}><circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none" /></SidebarIcon>;
}

/** Hollow dot: "mark as read". */
export function DotOutlineIcon(props: SidebarIconProps) {
  return <SidebarIcon {...props}><circle cx="12" cy="12" r="4.5" /></SidebarIcon>;
}

export function CheckIcon(props: SidebarIconProps) {
  return <SidebarIcon {...props}><path d="M20 6 9 17l-5-5" /></SidebarIcon>;
}

export function CloseIcon(props: SidebarIconProps) {
  return <SidebarIcon {...props}><path d="M18 6 6 18M6 6l12 12" /></SidebarIcon>;
}

export function SidebarToggleIcon({ open, ...props }: SidebarIconProps & { open: boolean }) {
  return (
    <SidebarIcon {...props} strokeWidth={1.7}>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M9 4v16" />
      <path d={open ? "m16 9-3 3 3 3" : "m13 9 3 3-3 3"} />
    </SidebarIcon>
  );
}

export function FolderIcon({ open = false, ...props }: SidebarIconProps & { open?: boolean }) {
  return (
    <SidebarIcon {...props} pixelPath={open
      ? "M0 3h1V2h4v1h1v1h4v1h2v3h-1v2h-1v1H1v-1H0ZM1 3h3v1h1v1H3v2H2v2H1ZM4 6h7v2h-1v2H2V9h1V7h1Z"
      : "M0 3h1V2h4v1h1v1h5v1h1v5h-1v1H1v-1H0ZM1 4v6h10V5H5V4H4V3H2v1Z"}>
      <path d={open
        ? "M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.5 6a2 2 0 0 1-1.94 1.5H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v2"
        : "M3 8a2 2 0 0 1 2-2h3.4l1.9 1.9H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"} />
    </SidebarIcon>
  );
}

export function ComposeIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props} pixelPath="M1 2h5v1H2v7h7V6h1v5H1ZM9 0h2v1h1v2h-1v1h-1v1H9v1H8v1H7v1H4V5h1V4h1V3h1V2h1V1h1Z">
      <path d="M12 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
      <path d="m16 3 5 5M10 14l1-4L18 3a2.12 2.12 0 0 1 3 3l-7 7Z" />
    </SidebarIcon>
  );
}

export function FolderPlusIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <path d="M3 8a2 2 0 0 1 2-2h3.4l1.9 1.9H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M12 11v5M9.5 13.5h5" />
    </SidebarIcon>
  );
}

export function TerminalIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </SidebarIcon>
  );
}

export function ClockIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </SidebarIcon>
  );
}

export function SearchIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props} pixelPath="M2 1h5v1h1v1h1v4H8v1h1v1h1v1h1v1H9v-1H8V9H7V8H2V7H1V6H0V3h1V2h1ZM2 3v3h1v1h4V6h1V3H7V2H3v1Z">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </SidebarIcon>
  );
}

export function UploadIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5" />
      <path d="M12 3v12" />
    </SidebarIcon>
  );
}

export function RefreshIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </SidebarIcon>
  );
}

/** Git changes: a commit on a line. */
export function ChangesIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M3 12h6M15 12h6" />
    </SidebarIcon>
  );
}

/** What the file tree lists: the files tab's ignored-files switch. */
export function EyeIcon(props: SidebarIconProps) {
  return (
    <SidebarIcon {...props}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </SidebarIcon>
  );
}

export function MessageIcon(props: SidebarIconProps) {
  return <SidebarIcon {...props} pixelPath="M1 1h10v1h1v7H5v1H4v1H3v1H1ZM2 2v8h1V9h1V8h7V2Z">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </SidebarIcon>;
}

/** "@ mention in chat": the files tab's and the file viewer's insert-a-reference button. */
export function MentionIcon({ size = 11, ...props }: SidebarIconProps) {
  return (
    <SidebarIcon {...props} size={size} strokeWidth={2.2}>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </SidebarIcon>
  );
}

/**
 * The running-agent spinner. It turns through the `sidebar-spin` class
 * (app/sidebar-menu.css), which stands still under prefers-reduced-motion.
 */
export function SpinnerIcon({ className, ...props }: SidebarIconProps) {
  return (
    <SidebarIcon {...props} strokeWidth={2.8} className={className ? `sidebar-spin ${className}` : "sidebar-spin"}>
      <path d="M21 12a9 9 0 1 1-3.8-7.4" />
    </SidebarIcon>
  );
}
