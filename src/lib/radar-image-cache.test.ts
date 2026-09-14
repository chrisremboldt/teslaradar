import assert from "node:assert/strict";
import { test } from "node:test";
import {
  capRadarImageCache,
  clearRadarImageCache,
  evictRadarImages,
  radarImageCacheLimit,
  releaseRadarImage,
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

test("Tesla cache limit is 3; phone is capped at 16", () => {
  assert.equal(radarImageCacheLimit(true), 3);
  assert.equal(radarImageCacheLimit(true, 12), 3);
  assert.equal(radarImageCacheLimit(false, 12), 12);
  assert.equal(radarImageCacheLimit(false, 40), 16);
});
