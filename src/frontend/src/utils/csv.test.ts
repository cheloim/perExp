import { describe, it, expect, vi, afterEach } from "vitest";
import { toCsv, downloadCsv } from "./csv";

describe("toCsv", () => {
  it("incluye el encabezado una sola vez", () => {
    const csv = toCsv(["fecha", "monto"], [["2026-10-13", 100]]);

    expect(csv.split("\n")[0]).toBe("fecha,monto");
    expect(csv.split("\n")).toHaveLength(2);
  });

  it("escapa comas, comillas y saltos de línea", () => {
    const csv = toCsv(["a"], [["comas, adentro"], ['con "comillas"'], ["dos\nlineas"]]);

    expect(csv).toContain('"comas, adentro"');
    expect(csv).toContain('"con ""comillas"""');
    expect(csv).toContain('"dos\nlineas"');
  });

  it("deja vacíos los null y undefined, pero conserva el 0", () => {
    const csv = toCsv(["a", "b", "c"], [[null, undefined, 0]]);

    expect(csv.split("\n")[1]).toBe(",,0");
  });
});

describe("downloadCsv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("crea el Blob y dispara la descarga", () => {
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadCsv("reviews.csv", ["fecha"], [["2026-10-13"]]);

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
    expect(document.querySelector("a")).toBeNull();
  });
});
