import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { matchesMedia, uploadImage } from "./media-upload";

vi.mock("./api", () => ({ api: { lookupMedia: vi.fn(), uploadMedia: vi.fn() } }));
const saved = {
  id: "existing",
  url: "https://media.example/image.png",
  originalName: "Tokyo.png",
  slug: "tokyo-trip",
  hashVerified: true,
  mimeType: "image/png",
  width: 1,
  height: 1,
  size: 3,
  slugUrl: null,
};
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
describe("browser upload preflight", () => {
  it("uses original bytes for lookup and avoids sending duplicate bytes", async () => {
    vi.mocked(api.lookupMedia).mockResolvedValue({ asset: saved });
    const result = await uploadImage(
      new File([new Uint8Array([1, 2, 3])], "renamed.png", { type: "image/png" }),
    );
    expect(api.lookupMedia).toHaveBeenCalledWith(
      "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    );
    expect(api.uploadMedia).not.toHaveBeenCalled();
    expect(result).toEqual({ asset: saved, duplicate: true });
  });
  it("uploads new files and handles a duplicate found by the server during a race", async () => {
    vi.mocked(api.lookupMedia).mockResolvedValue({ asset: null });
    vi.mocked(api.uploadMedia).mockResolvedValue({ ...saved, duplicate: true });
    const file = new File([new Uint8Array([1])], "new.png", { type: "image/png" });
    expect((await uploadImage(file, "tokyo-trip")).duplicate).toBe(true);
    expect(api.uploadMedia).toHaveBeenCalledWith(file, undefined, "tokyo-trip");
  });
  it("falls back to authoritative server checks when browser crypto is unavailable", async () => {
    vi.stubGlobal("crypto", {});
    vi.mocked(api.uploadMedia).mockResolvedValue({ ...saved, duplicate: false });
    expect(
      (await uploadImage(new File([new Uint8Array([1])], "new.png", { type: "image/png" })))
        .duplicate,
    ).toBe(false);
    expect(api.lookupMedia).not.toHaveBeenCalled();
  });
  it("surfaces lookup network errors so retry cannot bypass a failed preflight", async () => {
    vi.mocked(api.lookupMedia).mockRejectedValue(new TypeError("offline"));
    await expect(
      uploadImage(new File([new Uint8Array([1])], "a.png", { type: "image/png" })),
    ).rejects.toThrow("offline");
    expect(api.uploadMedia).not.toHaveBeenCalled();
  });
  it("rejects invalid sizes and formats before querying", async () => {
    await expect(uploadImage(new File([], "empty.png", { type: "image/png" }))).rejects.toThrow();
    await expect(
      uploadImage(new File(["<svg/>"], "image.svg", { type: "image/svg+xml" })),
    ).rejects.toThrow();
    expect(api.lookupMedia).not.toHaveBeenCalled();
  });
  it("searches filenames and Slugs as well as URLs", () => {
    for (const query of ["TOKYO", "tokyo-trip", "media.example", ""])
      expect(matchesMedia(saved, query)).toBe(true);
    expect(matchesMedia(saved, "missing")).toBe(false);
  });
});
