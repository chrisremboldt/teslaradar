import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeRainViewerCatalog, radarFramesToPreload } from "./radar-catalog.ts";

function catalog(paths: string[]) {
  return {
    host: "https://tilecache.rainviewer.com",
    generated: 1,
    frames: paths.map((path, i) => ({ time: i * 600_000, path })),
  };
}

test("radarFramesToPreload with Infinity (Play) returns the full past loop", () => {
  const frames = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"];
  assert.equal(frames.length, 13);
  const all = radarFramesToPreload(frames, 12, Number.POSITIVE_INFINITY);
  assert.deepEqual(all, frames);
  const paused = radarFramesToPreload(frames, 12, 0);
  assert.deepEqual(paused, ["m"]);
  const warm = radarFramesToPreload(frames, 12, 1);
  assert.deepEqual(warm, ["l", "m", "a"]);
});

test("mergeRainViewerCatalog jumps to newest when paused or first load", () => {
  const next = catalog(["/1", "/2", "/3"]);
  assert.deepEqual(mergeRainViewerCatalog(null, next, 0, false), {
    catalog: next,
    frameIndex: 2,
  });
  const prev = catalog(["/1", "/2"]);
  assert.equal(mergeRainViewerCatalog(prev, next, 0, false).frameIndex, 2);
});

test("mergeRainViewerCatalog keeps the playing path so the loop lands on newest", () => {
  const prev = catalog(["/a", "/b", "/c", "/d"]);
  const next = catalog(["/b", "/c", "/d", "/e"]);
  const merged = mergeRainViewerCatalog(prev, next, 1, true);
  assert.equal(merged.frameIndex, 0);
  assert.equal(merged.catalog.frames[0]?.path, "/b");
  assert.equal(merged.catalog.frames.at(-1)?.path, "/e");
});
