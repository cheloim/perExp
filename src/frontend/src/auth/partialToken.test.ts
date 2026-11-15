import { describe, it, expect, beforeEach } from "vitest";
import { clearPartialAuthToken, setPartialAuthToken, takePartialAuthToken } from "./partialToken";

beforeEach(() => clearPartialAuthToken());

describe("partialAuthToken", () => {
  it("entrega el token una sola vez", () => {
    setPartialAuthToken("token", "mfa");

    expect(takePartialAuthToken("mfa")).toBe("token");
    expect(takePartialAuthToken("mfa")).toBeNull();
  });

  it("no entrega un token de otro paso", () => {
    setPartialAuthToken("token", "password_change");

    expect(takePartialAuthToken("mfa")).toBeNull();
    expect(takePartialAuthToken("password_change")).toBe("token");
  });

  it("se puede limpiar", () => {
    setPartialAuthToken("token", "mfa");
    clearPartialAuthToken();

    expect(takePartialAuthToken("mfa")).toBeNull();
  });
});
