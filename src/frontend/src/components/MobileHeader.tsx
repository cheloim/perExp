import { APP_NAME } from "../config";
import { sidebarIcons } from "./SidebarIcons";

interface MobileHeaderProps {
  unreadCount: number;
  onOpenNotifications: () => void;
  onOpenUserPanel: () => void;
}

/**
 * Mobile header — Adwaita HeaderBar pattern
 * GNOME HIG: "header bars contain controls for the window and current view"
 * Actions on right, title on left.
 */
export default function MobileHeader({
  unreadCount,
  onOpenNotifications,
  onOpenUserPanel,
}: MobileHeaderProps) {
  return (
    <header className="md:hidden h-14 border-b border-[var(--border-color)] bg-sidebar flex items-center justify-between px-4 sticky top-0 z-40">
      {/* Left: Logo + App name */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center text-white text-[11px] font-bold">
          A
        </div>
        <span className="font-semibold text-[var(--color-on-sidebar)] tracking-tight">
          {APP_NAME}
        </span>
      </div>

      {/* Right: Notification bell + User avatar */}
      <div className="flex items-center gap-1">
        <button
          onClick={onOpenNotifications}
          aria-label={`${unreadCount} notificaciones sin leer`}
          className="relative p-2 rounded-md text-[var(--color-sidebar-icon)] hover:bg-[var(--color-base-alt)] transition-colors"
        >
          <span className="w-5 h-5 block">{sidebarIcons.bell}</span>
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 bg-[#ed333b] text-white text-[9px] font-semibold rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-0.5">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
        <button
          onClick={onOpenUserPanel}
          aria-label="Mi cuenta"
          className="p-2 rounded-md text-[var(--color-sidebar-icon)] hover:bg-[var(--color-base-alt)] transition-colors"
        >
          <span className="w-5 h-5 block">{sidebarIcons.user}</span>
        </button>
      </div>
    </header>
  );
}
