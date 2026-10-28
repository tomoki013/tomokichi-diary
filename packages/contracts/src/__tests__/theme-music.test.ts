import { describe, expect, it } from "vitest";
import { parseThemeMusic } from "../theme-music.js";

describe("parseThemeMusic", () => {
  it("resolves an Apple Music song, album and playlist", () => {
    expect(
      parseThemeMusic("apple_music", "https://music.apple.com/jp/album/x/1440818839?i=1440819020"),
    ).toMatchObject({
      provider: "apple_music",
      kind: "song",
      embedUrl: "https://embed.music.apple.com/jp/album/x/1440818839?i=1440819020",
      height: 175,
    });
    expect(
      parseThemeMusic("apple_music", "https://music.apple.com/jp/album/x/1440818839")?.kind,
    ).toBe("album");
    expect(
      parseThemeMusic("apple_music", "https://music.apple.com/jp/playlist/x/pl.u-abc123")?.kind,
    ).toBe("playlist");
  });

  it("reads the src out of Apple's embed code", () => {
    expect(
      parseThemeMusic(
        "apple_music",
        '<iframe height="175" src="https://embed.music.apple.com/jp/song/x/1440819020"></iframe>',
      )?.pageUrl,
    ).toBe("https://music.apple.com/jp/song/x/1440819020");
  });

  it("refuses other URLs and providers", () => {
    expect(parseThemeMusic("apple_music", "https://music.apple.com/jp/artist/x/1")).toBeNull();
    expect(parseThemeMusic("apple_music", "http://music.apple.com/jp/song/x/1")).toBeNull();
    expect(parseThemeMusic("apple_music", "javascript:alert(1)")).toBeNull();
    expect(parseThemeMusic("spotify", "https://music.apple.com/jp/song/x/1")).toBeNull();
    expect(parseThemeMusic("__proto__", "https://music.apple.com/jp/song/x/1")).toBeNull();
  });
});
