/**
 * Telegram Mini App integration.
 *
 * Handles WebApp SDK initialization, theme sync, auto-login via initData,
 * BackButton, HapticFeedback, and closing confirmation.
 * https://core.telegram.org/bots/webapps
 */

import { storeToken, telegramWebAppLogin } from "../api/client";

// ── Types ──────────────────────────────────────────────────────────────────

interface ThemeParams {
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
}

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
  themeParams: ThemeParams;
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setEmojiStatus(emoji: string): void;
  enableClosingConfirmation(): void;
  onEvent(eventType: string, eventHandler: () => void): void;
  offEvent(eventType: string, eventHandler: () => void): void;
  BackButton: {
    show(): void;
    hide(): void;
    onClick(callback: () => void): void;
    offClick(callback: () => void): void;
  };
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

// ── Public API ──────────────────────────────────────────────────────────────

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
  wa.enableClosingConfirmation();

  applyTelegramTheme();
  wa.onEvent("themeChanged", applyTelegramTheme);
}

export async function telegramAutoLogin(): Promise<boolean> {
  const wa = window.Telegram?.WebApp;
  if (!wa?.initData) return false;

  const existingToken = localStorage.getItem("auth_token");
  if (existingToken) return false;

  try {
    const { access_token } = await telegramWebAppLogin(wa.initData);
    storeToken(access_token);
    return true;
  } catch {
    return false;
  }
}

// ── Theme ───────────────────────────────────────────────────────────────────

function applyTelegramTheme(): void {
  const wa = window.Telegram?.WebApp;
  if (!wa) return;

  const tp = wa.themeParams;
  if (!tp) return;

  const root = document.documentElement;
  const set = (v: string | undefined, prop: string) => {
    if (v) root.style.setProperty(prop, v);
  };

  // Semantic colors first (these don't conflict)
  set(tp.accent_text_color, "--color-primary");
  set(tp.button_text_color, "--color-on-primary");
  set(tp.destructive_text_color, "--color-danger");

  // Background / surface
  set(tp.bg_color, "--color-base");
  set(tp.bg_color, "--color-sidebar");
  set(tp.secondary_bg_color, "--color-base-alt");
  set(tp.section_bg_color, "--color-surface");
  set(tp.section_bg_color, "--color-base-container");

  // Text
  set(tp.text_color, "--text-primary");
  set(tp.text_color, "--color-on-surface");
  set(tp.text_color, "--color-on-sidebar");
  set(tp.subtitle_text_color, "--text-secondary");
  set(tp.hint_color, "--text-tertiary");
  set(tp.hint_color, "--color-sidebar-icon");

  // Border — derive from color scheme
  root.style.setProperty(
    "--border-color",
    wa.colorScheme === "dark" ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
  );

  root.classList.add("tg-webapp");

  // Telegram's own chrome
  try {
    wa.setHeaderColor(tp.section_bg_color ?? tp.bg_color ?? "#ffffff");
    wa.setBackgroundColor(tp.bg_color ?? "#ffffff");
  } catch {
    // Non-critical
  }
}

// ── BackButton ──────────────────────────────────────────────────────────────

type BackButtonHandler = () => void;
let backHandlerRegistered: BackButtonHandler | null = null;

export function showBackButton(onClick: BackButtonHandler): void {
  const wa = window.Telegram?.WebApp;
  if (!wa?.BackButton) return;

  if (backHandlerRegistered) {
    wa.BackButton.offClick(backHandlerRegistered);
  }
  wa.BackButton.onClick(onClick);
  wa.BackButton.show();
  backHandlerRegistered = onClick;
}

export function hideBackButton(): void {
  const wa = window.Telegram?.WebApp;
  if (!wa?.BackButton) return;

  if (backHandlerRegistered) {
    wa.BackButton.offClick(backHandlerRegistered);
    backHandlerRegistered = null;
  }
  wa.BackButton.hide();
}

// ── HapticFeedback ──────────────────────────────────────────────────────────

export function hapticSuccess(): void {
  window.Telegram?.WebApp?.HapticFeedback.notificationOccurred("success");
}

export function hapticError(): void {
  window.Telegram?.WebApp?.HapticFeedback.notificationOccurred("error");
}

export function hapticLight(): void {
  window.Telegram?.WebApp?.HapticFeedback.impactOccurred("light");
}
