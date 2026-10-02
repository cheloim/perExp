import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  setTheme: () => {},
  toggleTheme: () => {},
});

/** CSS variables that Telegram's theme overrides via inline styles */
const TELEGRAM_OVERRIDDEN_VARS = [
  "--color-primary",
  "--color-on-primary",
  "--color-danger",
  "--color-base",
  "--color-sidebar",
  "--color-base-alt",
  "--color-surface",
  "--color-base-container",
  "--text-primary",
  "--color-on-surface",
  "--color-on-sidebar",
  "--text-secondary",
  "--text-tertiary",
  "--color-sidebar-icon",
  "--border-color",
];

/** Clear inline styles set by Telegram's theme so CSS class-based styles take over */
function clearTelegramInlineStyles() {
  const root = document.documentElement;
  for (const v of TELEGRAM_OVERRIDDEN_VARS) {
    root.style.removeProperty(v);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem("theme");
    return stored === "dark" || stored === "light" ? stored : "light";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  const setTheme = (t: Theme) => {
    clearTelegramInlineStyles();
    setThemeState(t);
  };
  const toggleTheme = () => {
    clearTelegramInlineStyles();
    setThemeState((t) => (t === "light" ? "dark" : "light"));
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
