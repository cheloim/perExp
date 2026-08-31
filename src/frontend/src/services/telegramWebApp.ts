/**
 * Telegram Mini App integration.
 *
 * Handles WebApp SDK initialization, theme sync, and auto-login via initData.
 * https://core.telegram.org/bots/webapps
 */

import { storeToken, telegramWebAppLogin } from "../api/client";

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    auth_date?: string;
    hash?: string;
  };
  themeParams: {
    bg_color?: string;
    text_color?: string;
    hint_color?: string;
    link_color?: string;
    button_color?: string;
    button_text_color?: string;
    secondary_bg_color?: string;
    header_bg_color?: string;
    accent_text_color?: string;
    section_bg_color?: string;
    section_header_text_color?: string;
    subtitle_text_color?: string;
    destructive_text_color?: string;
  };
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setEmojiStatus(emoji: string): void;
  enableClosingConfirmation(): void;
  HapticFeedback: {
    impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notificationOccurred: (type: "error" | "success" | "warning") => void;
    selectionChanged: () => void;
  };
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}

export function isTelegramWebApp(): boolean {
  return typeof window !== "undefined" && !!window.Telegram?.WebApp?.initData;
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

export function initTelegramWebApp(): void {
  const wa = window.Telegram?.WebApp;
  if (!wa) return;

  wa.ready();
  wa.expand();

  // Theme sync — map Telegram themeParams to app CSS variables
  const tp = wa.themeParams;
  if (tp) {
    const root = document.documentElement;
    if (tp.bg_color) root.style.setProperty("--bg-primary", tp.bg_color);
    if (tp.text_color) root.style.setProperty("--text-primary", tp.text_color);
    if (tp.hint_color) root.style.setProperty("--text-tertiary", tp.hint_color);
    if (tp.secondary_bg_color) root.style.setProperty("--color-base-alt", tp.secondary_bg_color);
    if (tp.button_color) root.style.setProperty("--color-primary", tp.button_color);
    if (tp.button_text_color) root.style.setProperty("--color-on-primary", tp.button_text_color);
    if (tp.section_bg_color) root.style.setProperty("--color-surface", tp.section_bg_color);
    if (tp.accent_text_color) root.style.setProperty("--color-primary", tp.accent_text_color);
    if (tp.destructive_text_color)
      root.style.setProperty("--color-danger", tp.destructive_text_color);
    root.classList.add("tg-webapp");
  }

  // Sync color scheme
  try {
    wa.setHeaderColor("#1a1a2e");
    wa.setBackgroundColor(tp?.bg_color ?? "#1a1a2e");
  } catch {
    // Non-critical
  }
}

export async function telegramAutoLogin(): Promise<boolean> {
  const wa = window.Telegram?.WebApp;
  if (!wa?.initData) return false;

  // Don't login if we already have a token
  const existingToken = localStorage.getItem("auth_token");
  if (existingToken) return false;

  try {
    const { access_token } = await telegramWebAppLogin(wa.initData);
    storeToken(access_token);
    return true;
  } catch {
    // Invalid or unlinked account — user will see login page
    return false;
  }
}
