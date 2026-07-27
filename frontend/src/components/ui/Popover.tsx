import { useEffect, useRef } from "react";

interface PopoverProps {
  children: React.ReactNode;
  content: React.ReactNode;
  isOpen: boolean;
  onClose: () => void;
  className?: string;
  align?: "left" | "center" | "right";
}

export function Popover({
  children,
  content,
  isOpen,
  onClose,
  className = "",
  align = "center",
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, onClose]);

  const alignClass = {
    left: "left-0",
    center: "left-1/2 -translate-x-1/2",
    right: "right-0",
  }[align];

  return (
    <div ref={ref} className={`relative ${className}`}>
      {children}
      {isOpen && (
        <div
          className={`absolute z-50 mt-2 ${alignClass} min-w-[200px] bg-[var(--color-surface)] border border-[var(--border-color)] rounded-lg shadow-gnome-lg overflow-hidden`}
        >
          {content}
        </div>
      )}
    </div>
  );
}
