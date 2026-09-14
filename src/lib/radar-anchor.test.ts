import assert from "node:assert/strict";
import { test } from "node:test";
import { RADAR_ANCHOR_SLOP } from "./constants.ts";
import { radarAnchorStillCovers } from "./radar-anchor.ts";

const base = { lat: 36.1627, lon: -86.7816, zoom: 6, size: 512 };

test("lean radar-anchor slop is wide (0.5 tile) so highway hops reuse the PNG", () => {
  assert.equal(RADAR_ANCHOR_SLOP, 0.5);
  const hop = { ...base, lat: base.lat + 4000 / 110_540 };
  assert.equal(radarAnchorStillCovers(base, hop), true);
  assert.equal(radarAnchorStillCovers(base, hop, RADAR_ANCHOR_SLOP), true);
  // ~200 km north at zoom 6 sits between 0.25 and 0.5 tile.
  const highway = { ...base, lat: base.lat + 200_000 / 110_540 };
  assert.equal(radarAnchorStillCovers(base, highway, 0.25), false);
  assert.equal(radarAnchorStillCovers(base, highway, RADAR_ANCHOR_SLOP), true);
});

test("a zoom-band change or a tile-scale jump refetches", () => {
  assert.equal(radarAnchorStillCovers(base, { ...base, zoom: 7 }), false);
  assert.equal(radarAnchorStillCovers(base, { ...base, lat: base.lat + 8 }), false);
  assert.equal(radarAnchorStillCovers(base, { ...base, size: 256 }), false);
});
