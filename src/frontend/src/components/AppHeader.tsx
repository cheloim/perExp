import { APP_NAME } from "../config";
import { sidebarIcons } from "./SidebarIcons";

interface AppHeaderProps {
  unreadCount: number;
  onOpenNotifications: () => void;
  onOpenUserPanel: () => void;
}

/**
 * Header bar — GNOME Adwaita HeaderBar pattern: identity on the left, view and
 * window actions on the right.
 *
 * The notification bell lives here, at the top right, and not at the bottom of
 * the sidebar: #455 reported that down there it disappeared into the window.
 * Same reason the account button moved — one obvious place for both.
 *
 * Sits at z-20 on purpose: the expanding sidebar is z-30 and has to slide over
 * it when hovered.
 */
export default function AppHeader({
  unreadCount,
  onOpenNotifications,
  onOpenUserPanel,
}: AppHeaderProps) {
  return (
    <header className="h-14 border-b border-[var(--border-color)] bg-sidebar flex items-center justify-between px-4 sticky top-0 z-20">
      {/* Identity — the sidebar carries it on desktop */}
      <div className="flex items-center gap-2 md:hidden">
        <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center text-white text-[11px] font-bold">
          A
        </div>
        <span className="font-semibold text-[var(--color-on-sidebar)] tracking-tight">
          {APP_NAME}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={onOpenNotifications}
          data-tour="header-notifications"
          title="Notificaciones"
          aria-label={`${unreadCount} notificaciones sin leer`}
          aria-haspopup="dialog"
          className="relative p-2 rounded-md text-[var(--color-sidebar-icon)] hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)] transition-colors"
        >
          <span className="w-5 h-5 block">{sidebarIcons.bell}</span>
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 bg-[#ed333b] text-white text-[10px] font-semibold rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        <button
          onClick={onOpenUserPanel}
          data-tour="header-account"
          title="Mi cuenta"
          aria-label="Mi cuenta"
          className="p-2 rounded-md text-[var(--color-sidebar-icon)] hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)] transition-colors"
        >
          <span className="w-5 h-5 block">{sidebarIcons.user}</span>
        </button>
      </div>
    </header>
  );
}
