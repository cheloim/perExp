import { describe, it, expect, beforeEach } from "vitest";
import {
  MAX_SAVED_VIEWS,
  MAX_VIEW_NAME,
  SAVED_VIEWS_KEY,
  addSavedView,
  buildSavedView,
  persistSavedViews,
  readSavedViews,
  removeSavedView,
  type SavedView,
} from "./savedViews";

beforeEach(() => localStorage.clear());

describe("saved views storage", () => {
  it("returns an empty list when nothing was stored", () => {
    expect(readSavedViews()).toEqual([]);
  });

  it("ignores corrupt or foreign entries", () => {
    localStorage.setItem(SAVED_VIEWS_KEY, "not json");
    expect(readSavedViews()).toEqual([]);

    localStorage.setItem(
      SAVED_VIEWS_KEY,
      JSON.stringify([
        { id: 1, name: null },
        { name: "ok", params: "", createdAt: 1 },
      ]),
    );
    expect(readSavedViews()).toEqual([]);
  });

  it("round-trips what it persists", () => {
    const view = buildSavedView("Trimestre", "range=3m", 1000)!;
    persistSavedViews([view]);
    expect(readSavedViews()).toEqual([view]);
  });

  it("trims and caps the name", () => {
    const view = buildSavedView(`  ${"x".repeat(60)}  `, "range=3m", 1000)!;
    expect(view.name).toHaveLength(MAX_VIEW_NAME);
  });

  it("rejects empty names or empty filters", () => {
    expect(buildSavedView("   ", "range=3m")).toBeNull();
    expect(buildSavedView("Trimestre", "")).toBeNull();
  });

  it("never stores the transient suggestions flag", () => {
    const view = buildSavedView("Con aviso", "category_suggestions=1&q=netflix", 1000)!;
    expect(view.params).toBe("q=netflix");
  });

  it("replaces a view with the same name instead of duplicating it", () => {
    const first = buildSavedView("Trimestre", "range=3m", 1000)!;
    const second = buildSavedView("trimestre", "range=6m", 2000)!;
    const views = addSavedView([first], second);

    expect(views).toHaveLength(1);
    expect(views[0].params).toBe("range=6m");
  });

  it("keeps at most ten views, newest first", () => {
    let views: SavedView[] = [];
    for (let i = 0; i < MAX_SAVED_VIEWS + 3; i++) {
      views = addSavedView(views, buildSavedView(`Vista ${i}`, `q=${i}`, i)!);
    }

    expect(views).toHaveLength(MAX_SAVED_VIEWS);
    expect(views[0].name).toBe(`Vista ${MAX_SAVED_VIEWS + 2}`);
  });

  it("removes by id", () => {
    const view = buildSavedView("Trimestre", "range=3m", 1000)!;
    expect(removeSavedView([view], view.id)).toEqual([]);
    expect(removeSavedView([view], "other")).toEqual([view]);
  });
});
