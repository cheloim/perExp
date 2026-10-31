import { NavLink } from "react-router-dom";
import { APP_NAME } from "../config";
import { sidebarIcons } from "./SidebarIcons";
import ImportUploadButton from "./ImportUploadButton";

export interface SidebarTab {
  path: string;
  label: string;
  icon: string;
  exact: boolean;
  tour?: string;
}

interface SidebarProps {
  tabs: SidebarTab[];
  unreadCount: number;
  onOpenUserPanel: () => void;
  onOpenNotifications: () => void;
}

/**
 * Navigation sidebar — GNOME Adwaita NavigationSplitView pattern.
 *
 * Notifications sit in their own section, apart from the locations, following
 * the grouped sidebars of GNOME 50's AdwSidebar. The unread count is a suffix
 * on the row: compact over the bell on the rail, at the row's end when the
 * sidebar expands.
 */
export default function Sidebar({
  tabs,
  unreadCount,
  onOpenUserPanel,
  onOpenNotifications,
}: SidebarProps) {
  const rowClass = (isActive: boolean) => `
    group/nav relative flex items-center gap-3 px-2.5 py-2 rounded-md text-sm font-medium transition-all duration-150
    ${
      isActive
        ? "bg-[var(--color-base-alt)] text-[var(--color-sidebar-text-active)]"
        : "text-[var(--color-sidebar-icon)] hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)]"
    }
  `;

  const activeIndicator = (isActive: boolean) => (
    <span
      className={`absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 rounded-full bg-sidebar-indicator transition-opacity duration-150 ${
        isActive ? "opacity-100" : "opacity-0"
      } group-hover/nav:opacity-30`}
    />
  );

  return (
    <aside
      className="group fixed left-0 top-0 h-full z-30 bg-sidebar border-r border-[var(--border-color)] hidden md:flex flex-col w-16 hover:w-[220px] transition-all duration-300 overflow-hidden"
      role="navigation"
      aria-label="Navegación principal"
    >
      {/* Header */}
      <div className="h-14 flex items-center border-b border-[var(--border-color)] px-3 gap-3">
        <div className="w-8 h-8 flex-shrink-0 rounded-md bg-primary flex items-center justify-center text-white font-bold text-xs font-semibold">
          A
        </div>
        <span className="text-sm font-semibold text-[var(--color-on-sidebar)] whitespace-nowrap overflow-hidden w-0 opacity-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300 tracking-tight">
          {APP_NAME}
        </span>
      </div>

      {/* Nav links */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5 scrollbar-none">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end={tab.exact}
            title={tab.label}
            data-tour={tab.tour}
            className={({ isActive }) => rowClass(isActive)}
          >
            {({ isActive }) => (
              <>
                {activeIndicator(isActive)}
                <span
                  className={`w-5 h-5 flex-shrink-0 flex items-center justify-center ${
                    isActive ? "text-[var(--color-sidebar-icon-active)]" : ""
                  }`}
                >
                  {sidebarIcons[tab.icon as keyof typeof sidebarIcons]}
                </span>
                <span className="whitespace-nowrap overflow-hidden w-0 opacity-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300">
                  {tab.label}
                </span>
              </>
            )}
          </NavLink>
        ))}

        {/* Avisos — its own section, the way GNOME 50 groups sidebar items */}
        <div className="mt-2 mb-1.5 border-t border-[var(--border-color)]" />
        <div className="max-h-0 opacity-0 overflow-hidden group-hover:max-h-5 group-hover:opacity-100 transition-all duration-300">
          <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] whitespace-nowrap">
            Avisos
          </div>
        </div>

        <NavLink
          to="/notifications"
          title="Notificaciones"
          aria-label={
            unreadCount > 0 ? `Notificaciones, ${unreadCount} sin leer` : "Notificaciones"
          }
          data-tour="sidebar-notifications"
          onClick={(event) => {
            // The bell opens the center in place; the route stays for links.
            event.preventDefault();
            onOpenNotifications();
          }}
          className={({ isActive }) => rowClass(isActive)}
        >
          {({ isActive }) => (
            <>
              {activeIndicator(isActive)}
              <span className="relative w-5 h-5 flex-shrink-0 flex items-center justify-center">
                <span className={isActive ? "text-[var(--color-sidebar-icon-active)]" : ""}>
                  {sidebarIcons.bell}
                </span>
                {unreadCount > 0 && (
                  <span className="group-hover:hidden absolute -top-1.5 -right-1.5 bg-[#ed333b] text-white text-[9px] font-semibold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-0.5">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </span>
              <span className="whitespace-nowrap overflow-hidden w-0 opacity-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300">
                Notificaciones
              </span>
              {unreadCount > 0 && (
                <span className="ml-auto hidden group-hover:flex bg-[#ed333b] text-white text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] items-center justify-center px-1">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </>
          )}
        </NavLink>
      </nav>

      {/* Bottom actions */}
      <div className="px-2 py-3 border-t border-[var(--border-color)] space-y-0.5">
        <ImportUploadButton />

        <NavLink
          to="/guide"
          title="Guía de usuario"
          data-tour="sidebar-guide"
          className={({ isActive }) => rowClass(isActive)}
        >
          {({ isActive }) => (
            <>
              {activeIndicator(isActive)}
              <span
                className={`w-5 h-5 flex-shrink-0 flex items-center justify-center ${
                  isActive ? "text-[var(--color-sidebar-icon-active)]" : ""
                }`}
              >
                {sidebarIcons.guide}
              </span>
              <span className="whitespace-nowrap overflow-hidden w-0 opacity-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300">
                Guía
              </span>
            </>
          )}
        </NavLink>

        <button
          onClick={onOpenUserPanel}
          title="Mi cuenta"
          aria-label="Mi cuenta"
          data-tour="sidebar-account"
          className={rowClass(false) + " w-full"}
        >
          <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
            {sidebarIcons.accountCircle}
          </span>
          <span className="whitespace-nowrap overflow-hidden w-0 opacity-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300">
            Mi cuenta
          </span>
        </button>
      </div>
    </aside>
  );
}
