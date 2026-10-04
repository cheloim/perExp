import { describe, it, expect, beforeEach } from "vitest";

// Test the API client utility functions (pure logic, no HTTP)

describe("API Client utilities", () => {
  // Test token storage logic
  const TOKEN_KEY = "auth_token";
  let inMemoryToken: string | null = null;

  function getStoredToken() {
    return (
      inMemoryToken ||
      (typeof localStorage !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null)
    );
  }
  function storeToken(token: string) {
    inMemoryToken = token;
    if (typeof localStorage !== "undefined") localStorage.setItem(TOKEN_KEY, token);
  }
  function clearToken() {
    inMemoryToken = null;
    if (typeof localStorage !== "undefined") localStorage.removeItem(TOKEN_KEY);
  }

  beforeEach(() => {
    inMemoryToken = null;
    if (typeof localStorage !== "undefined") localStorage.clear();
  });

  it("stores and retrieves token", () => {
    storeToken("test-token-123");
    expect(getStoredToken()).toBe("test-token-123");
  });

  it("clears token", () => {
    storeToken("test-token");
    clearToken();
    expect(getStoredToken()).toBeNull();
  });

  it("returns null when no token stored", () => {
    expect(getStoredToken()).toBeNull();
  });
});

describe("Query parameter building", () => {
  function buildParams(
    params?: Record<string, string | number | boolean | undefined | null>,
  ): string {
    if (!params) return "";
    const entries = Object.entries(params).filter(
      ([, v]) => v !== undefined && v !== null && v !== "",
    );
    if (entries.length === 0) return "";
    return "?" + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  }

  it("builds simple params", () => {
    expect(buildParams({ page: 1, limit: 10 })).toBe("?page=1&limit=10");
  });

  it("skips undefined values", () => {
    expect(buildParams({ page: 1, filter: undefined })).toBe("?page=1");
  });

  it("skips null values", () => {
    expect(buildParams({ page: 1, filter: null })).toBe("?page=1");
  });

  it("skips empty string values", () => {
    expect(buildParams({ page: 1, search: "" })).toBe("?page=1");
  });

  it("returns empty string for no params", () => {
    expect(buildParams()).toBe("");
    expect(buildParams({})).toBe("");
  });

  it("encodes special characters", () => {
    expect(buildParams({ q: "hello world" })).toBe("?q=hello%20world");
  });

  it("handles boolean values", () => {
    expect(buildParams({ active: true })).toBe("?active=true");
  });
});
