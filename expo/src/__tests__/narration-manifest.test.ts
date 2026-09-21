// `parseChunkManifest` is pure, but it lives in a module that reaches for the
// Supabase client at import time. Neither dependency is exercised here.
jest.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: false,
  supabase: { functions: { invoke: jest.fn() } },
}));
jest.mock("@/lib/session", () => ({ bootstrapUser: jest.fn() }));

import { parseChunkManifest } from "@/lib/narration";

/**
 * What the client keeps from a manifest, and what it deliberately does not.
 *
 * The server sends one entry per chunk on every poll, `url: null` for the ones
 * that are not synthesized yet. A piece that cannot be played is not a piece
 * to anything that plays -- but its `char_count` is the only thing that makes
 * the chapter's total duration knowable before the chapter exists, which is
 * the whole reason the server sends it on an unready entry.
 */
describe("the manifest a poll answers with", () => {
  const payload = (chunks: number, ready: number) => ({
    chunks,
    chunk_manifest: Array.from({ length: chunks }, (_, index) => ({
      index,
      url: index < ready ? `https://audio/c${index}.mp3` : null,
      duration_ms: index < ready ? 45_120 : null,
      char_count: 8_610,
      ready: index < ready,
    })),
  });

  it("keeps only playable pieces as entries", () => {
    const manifest = parseChunkManifest(payload(3, 1));
    expect(manifest?.chunks).toBe(3);
    expect(manifest?.entries).toHaveLength(1);
    expect(manifest?.entries[0].url).toBe("https://audio/c0.mp3");
  });

  it("keeps the character counts of the pieces that do not exist yet", () => {
    // Without these the provisional total covers only chunk 0, so the scrubber
    // reads 100% of "~10:12" at the end of the first piece and then jumps to
    // "~20:00" when the second lands. A total that grows under a reader is the
    // thing the provisional flag exists to avoid.
    const manifest = parseChunkManifest(payload(3, 1));
    expect(manifest?.pending).toEqual([
      { index: 1, charCount: 8_610 },
      { index: 2, charCount: 8_610 },
    ]);
    const total = (manifest?.entries ?? []).reduce(
      (sum, entry) => sum + entry.charCount,
      0,
    ) + (manifest?.pending ?? []).reduce(
      (sum, entry) => sum + entry.charCount,
      0,
    );
    expect(total).toBe(3 * 8_610);
  });

  it("has nothing pending once every piece is playable", () => {
    const manifest = parseChunkManifest(payload(3, 3));
    expect(manifest?.entries).toHaveLength(3);
    expect(manifest?.pending).toEqual([]);
  });

  it("is undefined for a server that does not chunk at all", () => {
    expect(parseChunkManifest({ status: "PENDING" })).toBeUndefined();
  });
});
