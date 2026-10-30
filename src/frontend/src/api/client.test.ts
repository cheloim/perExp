import { afterEach, describe, expect, it, vi } from "vitest";

import { api, extractExpenseFromImage, transcribeAudio } from "./client";

describe("capture API wrappers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts audio as multipart and returns the transcript", async () => {
    const spy = vi
      .spyOn(api, "post")
      .mockResolvedValue({ data: { text: "hola", duration_seconds: 2, unclear: false } });

    const result = await transcribeAudio(new Blob(["x"], { type: "audio/webm" }), 2);

    expect(spy.mock.calls[0][0]).toBe("/capture/transcribe");
    expect(spy.mock.calls[0][1]).toBeInstanceOf(FormData);
    expect(spy.mock.calls[0][2]?.headers).toBeUndefined();
    expect(result.text).toBe("hola");
  });

  it("posts a receipt image and an optional hint as multipart", async () => {
    const spy = vi.spyOn(api, "post").mockResolvedValue({
      data: { status: "rejected", draft: null, reason: "no_total", message: "No pude leerlo." },
    });

    const image = new File(["png"], "receipt.png", { type: "image/png" });
    const result = await extractExpenseFromImage(image, "compré algo");

    expect(spy.mock.calls[0][0]).toBe("/capture/expense-image");
    expect(spy.mock.calls[0][1]).toBeInstanceOf(FormData);
    expect(spy.mock.calls[0][2]?.headers).toBeUndefined();
    expect(result.status).toBe("rejected");
  });
});
