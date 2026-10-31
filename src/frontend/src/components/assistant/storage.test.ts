import { describe, it, expect, beforeEach } from "vitest";
import { clearToken, getStoredToken, storeToken } from "../../api/client";
import { SHARED_STORAGE } from "./types";
import {
  THREAD_PERSISTENCE_KEY,
  THREAD_TIMESTAMP_KEY,
  THREAD_TTL_MS,
  clearAssistantStorage,
  isPersistedThreadExpired,
  isThreadPersistenceEnabled,
  markThreadSaved,
  setThreadPersistenceEnabled,
} from "./storage";

beforeEach(() => {
  localStorage.clear();
});

describe("assistant thread persistence", () => {
  it("está apagada por defecto", () => {
    expect(isThreadPersistenceEnabled()).toBe(false);
  });

  it("se puede activar y revocar", () => {
    setThreadPersistenceEnabled(true);
    expect(isThreadPersistenceEnabled()).toBe(true);
    localStorage.setItem(SHARED_STORAGE.thread, JSON.stringify([{ role: "user", text: "x" }]));

    setThreadPersistenceEnabled(false);
    expect(isThreadPersistenceEnabled()).toBe(false);
    expect(localStorage.getItem(SHARED_STORAGE.thread)).toBeNull();
  });

  it("expira el hilo guardado después del TTL", () => {
    localStorage.setItem(SHARED_STORAGE.thread, "[]");
    markThreadSaved(Date.now() - THREAD_TTL_MS - 1);
    expect(isPersistedThreadExpired()).toBe(true);

    markThreadSaved(Date.now() - 1000);
    expect(isPersistedThreadExpired()).toBe(false);
  });

  it("borra el hilo y todas las claves legacy", () => {
    localStorage.setItem(SHARED_STORAGE.thread, "[]");
    localStorage.setItem(THREAD_TIMESTAMP_KEY, "1");
    localStorage.setItem("ai_assistant_sessions", "[]");
    localStorage.setItem("ai_assistant_active", "x");
    localStorage.setItem("inv_assistant_sessions", "[]");
    localStorage.setItem("assistant_sessions", "[]");

    clearAssistantStorage();

    expect(localStorage.getItem(SHARED_STORAGE.thread)).toBeNull();
    expect(localStorage.getItem(THREAD_TIMESTAMP_KEY)).toBeNull();
    expect(localStorage.getItem("ai_assistant_sessions")).toBeNull();
    expect(localStorage.getItem("ai_assistant_active")).toBeNull();
    expect(localStorage.getItem("inv_assistant_sessions")).toBeNull();
    expect(localStorage.getItem("assistant_sessions")).toBeNull();
  });

  it("clearToken borra el token y el hilo financiero", () => {
    storeToken("token");
    localStorage.setItem(THREAD_PERSISTENCE_KEY, "true");
    localStorage.setItem(SHARED_STORAGE.thread, JSON.stringify([{ role: "user", text: "x" }]));

    clearToken();

    expect(getStoredToken()).toBeNull();
    expect(localStorage.getItem(SHARED_STORAGE.thread)).toBeNull();
    expect(isThreadPersistenceEnabled()).toBe(false);
  });
});
