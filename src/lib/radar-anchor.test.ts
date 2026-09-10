import assert from "node:assert/strict";
import { test } from "node:test";
import { radarAnchorStillCovers } from "./radar-anchor.ts";

const base = { lat: 36.1627, lon: -86.7816, zoom: 6, size: 512 };

test("a few kilometers of follow hop keeps the same radar image", () => {
  const hop = { ...base, lat: base.lat + 4000 / 110_540 };
  assert.equal(radarAnchorStillCovers(base, hop), true);
});

test("a zoom-band change or a tile-scale jump refetches", () => {
  assert.equal(radarAnchorStillCovers(base, { ...base, zoom: 7 }), false);
  assert.equal(radarAnchorStillCovers(base, { ...base, lat: base.lat + 8 }), false);
  assert.equal(radarAnchorStillCovers(base, { ...base, size: 256 }), false);
});
