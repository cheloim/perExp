import { describe, it, expect, beforeEach } from "vitest";
import {
  ASSISTANT_MODE_KEY,
  ASSISTANT_WIDTH_KEY,
  DOCKED_WIDTH_DEFAULT,
  DOCKED_WIDTH_MAX,
  DOCKED_WIDTH_MIN,
  clampDockedWidth,
  persistDockedMode,
  persistDockedWidth,
  readDockedMode,
  readDockedWidth,
} from "./layoutMode";

describe("assistant layout mode", () => {
  beforeEach(() => localStorage.clear());

  it("opens as the floating window when nothing was chosen", () => {
    expect(readDockedMode()).toBe("modal");
  });

  it("remembers the docked side panel", () => {
    persistDockedMode("docked");
    expect(localStorage.getItem(ASSISTANT_MODE_KEY)).toBe("docked");
    expect(readDockedMode()).toBe("docked");

    persistDockedMode("modal");
    expect(readDockedMode()).toBe("modal");
  });

  it("falls back to the floating window for a stored value it cannot read", () => {
    localStorage.setItem(ASSISTANT_MODE_KEY, "lateral");
    expect(readDockedMode()).toBe("modal");
  });

  it("starts the side panel at 400px", () => {
    expect(DOCKED_WIDTH_DEFAULT).toBe(400);
    expect(readDockedWidth()).toBe(400);
  });

  it("reads back the width it persisted", () => {
    persistDockedWidth(512);
    expect(localStorage.getItem(ASSISTANT_WIDTH_KEY)).toBe("512");
    expect(readDockedWidth()).toBe(512);
  });

  it("ignores a stored width that is not a number", () => {
    localStorage.setItem(ASSISTANT_WIDTH_KEY, "ancho");
    expect(readDockedWidth()).toBe(DOCKED_WIDTH_DEFAULT);
  });

  it("clamps between the minimum and 55% of the viewport", () => {
    expect(clampDockedWidth(10, 1600)).toBe(DOCKED_WIDTH_MIN);
    expect(clampDockedWidth(5000, 1600)).toBe(DOCKED_WIDTH_MAX);
    expect(clampDockedWidth(5000, 1000)).toBe(550);
    expect(clampDockedWidth(400, 1600)).toBe(400);
  });

  it("keeps a width saved on a bigger screen so a phone visit cannot shrink it", () => {
    localStorage.setItem(ASSISTANT_WIDTH_KEY, "720");
    expect(readDockedWidth()).toBe(720);
  });

  it("still clamps a stored width to the absolute range", () => {
    localStorage.setItem(ASSISTANT_WIDTH_KEY, "5000");
    expect(readDockedWidth()).toBe(DOCKED_WIDTH_MAX);
    localStorage.setItem(ASSISTANT_WIDTH_KEY, "10");
    expect(readDockedWidth()).toBe(DOCKED_WIDTH_MIN);
  });
});
