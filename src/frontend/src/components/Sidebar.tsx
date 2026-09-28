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
  currentUser?: { is_admin?: boolean } | null;
  adminSlug?: string | null;
  unreadCount: number;
  onOpenNotifications: () => void;
  onOpenUserPanel: () => void;
}

export default function Sidebar({
  tabs,
  currentUser,
  adminSlug,
  unreadCount,
  onOpenNotifications,
  onOpenUserPanel,
}: SidebarProps) {
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

      {/* Nav links — GNOME Adwaita sidebar style */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5 scrollbar-none">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end={tab.exact}
            title={tab.label}
            data-tour={tab.tour}
            className={({ isActive }) => `
              group/nav relative flex items-center gap-3 px-2.5 py-2 rounded-md text-sm font-medium transition-all duration-150
              ${
                isActive
                  ? "bg-[var(--color-base-alt)] text-[var(--color-sidebar-text-active)]"
                  : "text-[var(--color-sidebar-icon)] hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)]"
              }
            `}
          >
            {({ isActive }) => (
              <>
                {/* Active indicator bar — GNOME style */}
                <span
                  className={`absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 rounded-full bg-sidebar-indicator transition-opacity duration-150 ${
                    isActive ? "opacity-100" : "opacity-0"
                  } group-hover/nav:opacity-30`}
                />

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
      </nav>

      {/* Bottom actions */}
      <div className="px-2 py-3 border-t border-[var(--border-color)] space-y-0.5">
        {/* Admin button - only visible for admin users */}
        {currentUser?.is_admin && adminSlug && (
          <NavLink
            to={`/x/${adminSlug}`}
            title="Admin"
            className={({ isActive }) => `
              group/nav relative flex items-center gap-3 px-2.5 py-2 rounded-md text-sm font-medium transition-all duration-150
              ${
                isActive
                  ? "bg-[var(--color-base-alt)] text-[var(--color-sidebar-text-active)]"
                  : "text-[var(--color-sidebar-icon)] hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)]"
              }
            `}
          >
            {({ isActive }) => (
              <>
                <span
                  className={`absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 rounded-full bg-sidebar-indicator transition-opacity duration-150 ${
                    isActive ? "opacity-100" : "opacity-0"
                  } group-hover/nav:opacity-30`}
                />
                <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-6-3a2 2 0 11-4 0 2 2 0 014 0zm-2 4a5 5 0 00-4.546 2.916A5.986 5.986 0 0010 16a5.986 5.986 0 004.546-2.084A5 5 0 0010 11z"
                      clipRule="evenodd"
                    />
                  </svg>
                </span>
                <span className="whitespace-nowrap overflow-hidden w-0 opacity-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300">
                  Admin
                </span>
              </>
            )}
          </NavLink>
        )}

        {/* Bell — GNOME HIG: accessible notification indicator */}
        <div className="relative">
          <button
            onClick={onOpenNotifications}
            title="Notificaciones"
            aria-label={`${unreadCount} notificaciones sin leer`}
            data-tour="sidebar-notifications"
            className="group/notif relative w-full flex items-center gap-3 px-2.5 py-2 rounded-md text-sm font-medium text-[var(--color-sidebar-icon)] hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)] transition-all duration-150"
          >
            <span className="relative w-5 h-5 flex-shrink-0 flex items-center justify-center">
              {sidebarIcons.bell}
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-[#ed333b] text-white text-[10px] font-semibold rounded-full min-w-[16px] h-4 flex items-center justify-center px-0.5 animate-pulse">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </span>
            <span className="whitespace-nowrap overflow-hidden w-0 opacity-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300">
              Notificaciones
            </span>
          </button>
        </div>

        {/* Import Upload Button */}
        <ImportUploadButton />

        {/* Guide */}
        <NavLink
          to="/guide"
          title="Guía de usuario"
          data-tour="sidebar-guide"
          className={({ isActive }) => `
            group/nav relative w-full flex items-center gap-3 px-2.5 py-2 rounded-md text-sm font-medium transition-all duration-150
            ${
              isActive
                ? "bg-[var(--color-base-alt)] text-[var(--color-sidebar-text-active)]"
                : "text-[var(--color-sidebar-icon)] hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)]"
            }
          `}
        >
          {({ isActive }) => (
            <>
              <span
                className={`absolute left-0 top-1/2 -translate-y-1/2 h-6 w-0.5 rounded-full bg-sidebar-indicator transition-opacity duration-150 ${
                  isActive ? "opacity-100" : "opacity-0"
                } group-hover/nav:opacity-30`}
              />
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

        {/* User — GNOME HIG: accessible account button */}
        <button
          onClick={onOpenUserPanel}
          title="Mi cuenta"
          aria-label="Mi cuenta"
          data-tour="sidebar-account"
          className="group/user w-full flex items-center gap-3 px-2.5 py-2 rounded-md text-sm font-medium text-[var(--color-sidebar-icon)] hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)] transition-all duration-150"
        >
          <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center">
            {sidebarIcons.user}
          </span>
          <span className="whitespace-nowrap overflow-hidden w-0 opacity-0 group-hover:w-auto group-hover:opacity-100 transition-all duration-300">
            Mi cuenta
          </span>
        </button>
      </div>
    </aside>
  );
}
