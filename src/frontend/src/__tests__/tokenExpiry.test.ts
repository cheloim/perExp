import { beforeEach, describe, expect, it } from "vitest";
import { clearToken, isAccessTokenExpiring, storeToken, tokenExpiresAt } from "../api/client";

function makeToken(expSeconds: number): string {
  const payload = btoa(JSON.stringify({ sub: "1", exp: expSeconds }))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `header.${payload}.signature`;
}

describe("access token expiry", () => {
  beforeEach(() => {
    clearToken();
    localStorage.clear();
  });

  it("reads exp from the JWT payload", () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    storeToken(makeToken(exp));
    expect(tokenExpiresAt()).toBe(exp * 1000);
  });

  it("returns null for a malformed token", () => {
    storeToken("not-a-jwt");
    expect(tokenExpiresAt()).toBeNull();
  });

  it("returns null with no token", () => {
    expect(tokenExpiresAt()).toBeNull();
  });

  it("detects a token that expires inside the window", () => {
    storeToken(makeToken(Math.floor(Date.now() / 1000) + 60));
    expect(isAccessTokenExpiring(120)).toBe(true);
  });

  it("leaves a healthy token alone", () => {
    storeToken(makeToken(Math.floor(Date.now() / 1000) + 3600));
    expect(isAccessTokenExpiring(120)).toBe(false);
  });

  it("does not claim expiry when the token cannot be decoded", () => {
    storeToken("garbage");
    expect(isAccessTokenExpiring(120)).toBe(false);
  });
});
