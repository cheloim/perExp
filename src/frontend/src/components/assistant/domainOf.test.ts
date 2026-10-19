import { describe, it, expect } from "vitest";
import { domainOf } from "./domainOf";
import type { Session } from "./types";

function session(messages: Session["messages"]): Session {
  return { id: "s1", ts: 1, messages };
}

describe("domainOf", () => {
  it("returns initialDomain when the session is empty", () => {
    expect(domainOf(session([]), "spending")).toBe("spending");
    expect(domainOf(undefined, "investments")).toBe("investments");
  });

  it("returns the domain of the last message when present", () => {
    const s = session([
      { role: "user", text: "gasto", domain: "spending" },
      { role: "assistant", text: "ok", domain: "spending" },
      { role: "user", text: "cartera", domain: "investments" },
      { role: "assistant", text: "ok", domain: "investments" },
    ]);
    expect(domainOf(s, "spending")).toBe("investments");
  });

  it("falls back to initialDomain for legacy messages with no domain", () => {
    const s = session([
      { role: "user", text: "hola" },
      { role: "assistant", text: "hola!" },
    ]);
    expect(domainOf(s, "investments")).toBe("investments");
    expect(domainOf(s, "spending")).toBe("spending");
  });
});
