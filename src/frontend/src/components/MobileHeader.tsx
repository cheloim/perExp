import { Link } from "react-router-dom";
import { APP_NAME } from "../config";
import { sidebarIcons } from "./SidebarIcons";

interface MobileHeaderProps {
  unreadCount: number;
  onOpenUserPanel: () => void;
  onOpenNotifications: () => void;
}

/**
 * Mobile header — Adwaita HeaderBar pattern.
 *
 * Mobile only: on desktop the sidebar carries both the app identity and the
 * notification entry, so a header bar there would be two icons floating in an
 * otherwise empty strip.
 */
export default function MobileHeader({
  unreadCount,
  onOpenUserPanel,
  onOpenNotifications,
}: MobileHeaderProps) {
  return (
    <header className="md:hidden h-14 border-b border-[var(--border-color)] bg-sidebar flex items-center justify-between px-4 sticky top-0 z-20">
      {/* Left: logo + app name */}
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center text-white text-[11px] font-bold">
          A
        </div>
        <span className="font-semibold text-[var(--color-on-sidebar)] tracking-tight">
          {APP_NAME}
        </span>
      </div>

      {/* Right: notifications + account */}
      <div className="flex items-center gap-1">
        <Link
          to="/notifications"
          title="Notificaciones"
          aria-label={`${unreadCount} notificaciones sin leer`}
          onClick={(event) => {
            event.preventDefault();
            onOpenNotifications();
          }}
          className="relative p-2 rounded-md text-[var(--color-sidebar-icon)] hover:bg-[var(--color-base-alt)] transition-colors"
        >
          <span className="w-5 h-5 block">{sidebarIcons.bell}</span>
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 bg-[#ed333b] text-white text-[9px] font-semibold rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-0.5">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Link>
        <button
          onClick={onOpenUserPanel}
          aria-label="Mi cuenta"
          title="Mi cuenta"
          className="p-2 rounded-md text-[var(--color-sidebar-icon)] hover:bg-[var(--color-base-alt)] transition-colors"
        >
          <span className="w-5 h-5 block">{sidebarIcons.accountCircle}</span>
        </button>
      </div>
    </header>
  );
}
