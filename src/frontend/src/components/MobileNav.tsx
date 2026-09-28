import { useEffect, useRef } from "react";
import { NavLink } from "react-router-dom";
import { sidebarIcons } from "./SidebarIcons";
import type { SidebarTab } from "./Sidebar";

interface MobileNavProps {
  tabs: SidebarTab[];
  showMore: boolean;
  onToggleMore: (show: boolean) => void;
  onOpenUserPanel: () => void;
}

/**
 * Mobile bottom navigation — Adwaita ViewSwitcherBar pattern
 * GNOME HIG: "switch to the bottom window edge if the window becomes too narrow"
 * Shows first 4 tabs + "Más" menu for remaining items.
 */
export default function MobileNav({
  tabs,
  showMore,
  onToggleMore,
  onOpenUserPanel,
}: MobileNavProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close "Más" menu on Escape key (GNOME HIG: Esc = cancel)
  useEffect(() => {
    if (!showMore) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onToggleMore(false);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [showMore, onToggleMore]);

  return (
    <nav
      className="md:hidden border-t border-[var(--border-color)] bg-sidebar flex items-center justify-around pb-safe pt-1 z-40 fixed inset-x-0 bottom-0 translate-y-[var(--browser-bottom-inset)]"
      role="navigation"
      aria-label="Navegación inferior"
    >
      {tabs.slice(0, 4).map((tab) => (
        <NavLink
          key={tab.path}
          to={tab.path}
          end={tab.exact}
          aria-label={tab.label}
          className={({ isActive }) => `
            flex flex-col items-center gap-1 p-2 min-w-[64px] text-[10px] font-medium transition-colors
            ${isActive ? "text-primary" : "text-[var(--color-sidebar-icon)]"}
          `}
        >
          <span className="w-5 h-5 mb-0.5">
            {sidebarIcons[tab.icon as keyof typeof sidebarIcons]}
          </span>
          <span className="truncate w-full text-center">{tab.label.split(" ")[0]}</span>
        </NavLink>
      ))}

      {/* "Más" button — GNOME HIG: accessible overflow menu */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => onToggleMore(!showMore)}
          aria-expanded={showMore}
          aria-haspopup="menu"
          aria-label="Más opciones de navegación"
          className="flex flex-col items-center gap-1 p-2 min-w-[64px] text-[10px] font-medium transition-colors text-[var(--color-sidebar-icon)]"
        >
          <span className="w-5 h-5 mb-0.5">{sidebarIcons.more}</span>
          <span className="truncate w-full text-center">Más</span>
        </button>

        {showMore && (
          <>
            <div
              className="fixed inset-0 z-30"
              onClick={() => onToggleMore(false)}
              aria-hidden="true"
            />
            <div
              className="absolute bottom-full right-2 mb-2 bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg shadow-lg py-2 min-w-[180px] z-40"
              role="menu"
              aria-label="Menú de navegación adicional"
            >
              {/* User account button */}
              <button
                onClick={() => {
                  onToggleMore(false);
                  onOpenUserPanel();
                }}
                role="menuitem"
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--color-base-alt)] transition-colors w-full"
              >
                <span className="w-5 h-5">{sidebarIcons.user}</span>
                <span>Mi cuenta</span>
              </button>
              <div className="border-t border-[var(--border-color)] my-1" />
              {tabs.slice(4).map((tab) => (
                <NavLink
                  key={tab.path}
                  to={tab.path}
                  end={tab.exact}
                  role="menuitem"
                  onClick={() => onToggleMore(false)}
                  className={({ isActive }) => `
                    flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
                    ${
                      isActive
                        ? "text-primary bg-primary/5"
                        : "text-[var(--text-primary)] hover:bg-[var(--color-base-alt)]"
                    }
                  `}
                >
                  <span className="w-5 h-5">
                    {sidebarIcons[tab.icon as keyof typeof sidebarIcons]}
                  </span>
                  <span>{tab.label}</span>
                </NavLink>
              ))}
            </div>
          </>
        )}
      </div>
    </nav>
  );
}
