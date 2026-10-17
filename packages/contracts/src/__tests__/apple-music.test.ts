import { describe, expect, it } from "vitest";
import {
  enhanceAppleMusic,
  invalidAppleMusicReferences,
  parseAppleMusicUrl,
} from "../apple-music.js";

describe("parseAppleMusicUrl", () => {
  it("reads a song shared from an album as a compact player", () => {
    expect(
      parseAppleMusicUrl("https://music.apple.com/jp/album/lemon/1366614946?i=1366615058"),
    ).toEqual({
      kind: "song",
      embedUrl: "https://embed.music.apple.com/jp/album/lemon/1366614946?i=1366615058",
      pageUrl: "https://music.apple.com/jp/album/lemon/1366614946?i=1366615058",
      height: 175,
    });
  });

  it("reads song, album and playlist URLs, including Apple's embed URLs", () => {
    expect(parseAppleMusicUrl("https://music.apple.com/jp/song/lemon/1366615058")?.kind).toBe(
      "song",
    );
    expect(
      parseAppleMusicUrl("https://music.apple.com/jp/album/stray-sheep/1528151447"),
    ).toMatchObject({
      kind: "album",
      height: 450,
    });
    expect(
      parseAppleMusicUrl("https://embed.music.apple.com/jp/playlist/travel/pl.u-abc123XYZ"),
    ).toMatchObject({
      kind: "playlist",
      embedUrl: "https://embed.music.apple.com/jp/playlist/travel/pl.u-abc123XYZ",
      height: 450,
    });
    // Tracking parameters are dropped; only the track id survives.
    expect(
      parseAppleMusicUrl("https://music.apple.com/us/album/x/1?i=2&ls=1&app=music")?.embedUrl,
    ).toBe("https://embed.music.apple.com/us/album/x/1?i=2");
  });

  it("refuses anything that is not a player", () => {
    for (const url of [
      "http://music.apple.com/jp/album/x/1",
      "https://music.apple.com.evil.example/jp/album/x/1",
      "https://music.apple.com/jp/artist/x/1",
      "https://music.apple.com/jp/playlist/x/123",
      "https://music.apple.com/jp/album/x/abc",
      "https://music.apple.com/jp/album/x/1/extra/path",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(parseAppleMusicUrl(url), url).toBeNull();
    }
  });
});

describe("enhanceAppleMusic", () => {
  const song = "https://music.apple.com/jp/album/lemon/1366614946?i=1366615058";

  it("turns a bare or linked URL paragraph into the player", () => {
    for (const html of [
      `<p>${song.replace("&", "&amp;")}</p>`,
      `<p><a href="${song}">${song}</a></p>`,
    ]) {
      const out = enhanceAppleMusic(html);
      expect(out).toContain('<figure class="apple-music apple-music--song">');
      expect(out).toContain(
        'src="https://embed.music.apple.com/jp/album/lemon/1366614946?i=1366615058"',
      );
      expect(out).toContain('height="175"');
      expect(out).toContain('loading="lazy"');
    }
  });

  it("rebuilds Apple's pasted iframe with our attributes only", () => {
    const pasted =
      '<p><iframe allow="autoplay *" frameborder="0" height="450" style="width:100%" onload="steal()" sandbox="allow-scripts" src="https://embed.music.apple.com/jp/playlist/travel/pl.u-abc123"></iframe></p>';
    const out = enhanceAppleMusic(pasted);
    expect(out).toContain("apple-music--playlist");
    expect(out).not.toContain("onload");
    expect(out).not.toContain("<p>");
  });

  it("leaves links inside text and other frames alone", () => {
    const inline = `<p>聴いていたのは <a href="${song}">Lemon</a> でした。</p>`;
    expect(enhanceAppleMusic(inline)).toBe(inline);
    const map = '<iframe src="https://www.google.com/maps/embed?pb=1"></iframe>';
    expect(enhanceAppleMusic(map)).toBe(map);
  });
});

describe("invalidAppleMusicReferences", () => {
  it("reports an Apple Music line that cannot become a player", () => {
    const body = [
      "本文",
      "https://music.apple.com/jp/album/lemon/1366614946?i=1366615058",
      "https://music.apple.com/jp/artist/kenshi-yonezu/1012345",
      "```",
      "https://music.apple.com/jp/artist/in-code/1",
      "```",
    ].join("\n\n");
    expect(invalidAppleMusicReferences(body)).toEqual([
      "https://music.apple.com/jp/artist/kenshi-yonezu/1012345",
    ]);
  });
});
