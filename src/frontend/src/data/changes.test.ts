import { describe, expect, it } from "vitest";
import { CHANGES, LATEST_VERSION, getVersion } from "./changes";

describe("release changelog", () => {
  it("keeps LATEST_VERSION in sync with the newest entry", () => {
    expect(LATEST_VERSION).toBe(CHANGES[0].version);
  });

  it("chains every version back to the one it replaced", () => {
    CHANGES.forEach((version, index) => {
      const older = CHANGES[index + 1];
      expect(version.previous).toBe(older?.version);
    });
  });

  it("does not repeat versions or feature titles", () => {
    expect(new Set(CHANGES.map((version) => version.version)).size).toBe(CHANGES.length);

    for (const version of CHANGES) {
      const titles = version.features.map((feature) => feature.title);
      expect(new Set(titles).size).toBe(titles.length);
    }
  });

  it("ships v1.6 with a summary and the six UX blocks", () => {
    const latest = getVersion("v1.6");

    expect(latest?.summary).toBeTruthy();
    expect(latest?.features).toHaveLength(6);
  });
});
