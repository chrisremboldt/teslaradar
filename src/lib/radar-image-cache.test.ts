import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RADAR_IMAGE_CACHE_LIMIT,
  RADAR_IMAGE_CACHE_LIMIT_ANIMATED,
} from "./constants.ts";
import {
  capRadarImageCache,
  clearRadarImageCache,
  evictRadarImages,
  isRadarPlayReady,
  radarImageCacheLimit,
  releaseRadarImage,
  resolveRadarPaintImage,
  shouldAdvanceRadarPlayhead,
  shrinkRadarImageCacheToPlayhead,
} from "./radar-image-cache.ts";

function img(src: string) {
  return { src };
}

test("releaseRadarImage clears src so the bitmap can GC", () => {
  const image = img("https://example.com/radar.png");
  releaseRadarImage(image);
  assert.equal(image.src, "");
});

test("evictRadarImages releases evicted bitmaps and keeps wanted urls", () => {
  const cache = new Map([
    ["keep", img("keep.png")],
    ["drop", img("drop.png")],
  ]);
  const n = evictRadarImages(cache, new Set(["keep"]));
  assert.equal(n, 1);
  assert.equal(cache.size, 1);
  assert.equal(cache.get("keep")?.src, "keep.png");
  assert.equal(cache.has("drop"), false);
});

test("capRadarImageCache evicts oldest non-keep entries and clears src", () => {
  const a = img("a.png");
  const b = img("b.png");
  const c = img("c.png");
  const cache = new Map([
    ["a", a],
    ["b", b],
    ["c", c],
  ]);
  const n = capRadarImageCache(cache, 2, new Set(["c"]));
  assert.equal(n, 1);
  assert.equal(cache.size, 2);
  assert.equal(a.src, "");
  assert.equal(cache.has("c"), true);
  assert.equal(cache.has("b"), true);
});

test("clearRadarImageCache releases every image", () => {
  const a = img("a.png");
  const cache = new Map([["a", a]]);
  clearRadarImageCache(cache);
  assert.equal(cache.size, 0);
  assert.equal(a.src, "");
});

test("cache limit is 1 paused and covers a full past loop when playing", () => {
  assert.equal(radarImageCacheLimit(true), 1);
  assert.equal(radarImageCacheLimit(true, 1), 1);
  assert.equal(radarImageCacheLimit(true, 13), 13);
  assert.ok(radarImageCacheLimit(true, 13) >= 10);
  assert.ok(radarImageCacheLimit(false, 12) >= 10);
  assert.equal(radarImageCacheLimit(false, 16), RADAR_IMAGE_CACHE_LIMIT_ANIMATED);
  assert.ok(RADAR_IMAGE_CACHE_LIMIT_ANIMATED >= 10);
  assert.equal(RADAR_IMAGE_CACHE_LIMIT, 1);
});

test("resolveRadarPaintImage holds the last good frame when the next is missing", () => {
  const last = img("frame-4.png");
  const images = new Map([["frame-4.png", last]]);
  const held = resolveRadarPaintImage(images, "frame-5.png", "frame-4.png");
  assert.deepEqual(held, { image: last, url: "frame-4.png", held: true });

  const current = img("frame-5.png");
  images.set("frame-5.png", current);
  const ready = resolveRadarPaintImage(images, "frame-5.png", "frame-4.png");
  assert.deepEqual(ready, { image: current, url: "frame-5.png", held: false });

  assert.equal(resolveRadarPaintImage(images, "missing.png", "also-missing.png"), null);
  assert.equal(resolveRadarPaintImage(new Map(), "", null), null);
});

test("pause shrinks the cache to the playhead and clears evicted src", () => {
  const keep = img("latest.png");
  const extra = img("old.png");
  const cache = new Map([
    ["old.png", extra],
    ["latest.png", keep],
    ["older.png", img("older.png")],
  ]);
  const n = shrinkRadarImageCacheToPlayhead(cache, "latest.png", RADAR_IMAGE_CACHE_LIMIT);
  assert.ok(n >= 2);
  assert.equal(cache.size, 1);
  assert.equal(cache.get("latest.png")?.src, "latest.png");
  assert.equal(extra.src, "");
});

test("playhead waits for warm neighbors, then a timeout unblocks Play", () => {
  assert.equal(isRadarPlayReady("1"), true);
  assert.equal(isRadarPlayReady("0"), false);
  assert.equal(isRadarPlayReady(null), false);
  assert.equal(shouldAdvanceRadarPlayhead({ ready: true, elapsedMs: 0, timeoutMs: 2000 }), true);
  assert.equal(shouldAdvanceRadarPlayhead({ ready: false, elapsedMs: 400, timeoutMs: 2000 }), false);
  assert.equal(shouldAdvanceRadarPlayhead({ ready: false, elapsedMs: 2000, timeoutMs: 2000 }), true);
});
