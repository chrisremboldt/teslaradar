import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coordsFromPlaceKey,
  placeLookupKey,
  shouldRestartPlaceLookup,
} from "./place-lookup.ts";

test("placeLookupKey groups GPS jitter inside ~1 km", () => {
  const a = placeLookupKey(36.1627, -86.7816);
  const b = placeLookupKey(36.1641, -86.7801);
  assert.equal(a, b);
  assert.equal(a, "36.16,-86.78");
  assert.notEqual(placeLookupKey(36.1627, -86.7816), placeLookupKey(36.18, -86.7816));
});

test("shouldRestartPlaceLookup ignores raw-coordinate noise in the same cell", () => {
  const key = placeLookupKey(36.1627, -86.7816);
  assert.equal(shouldRestartPlaceLookup(key, placeLookupKey(36.165, -86.779)), false);
  assert.equal(shouldRestartPlaceLookup(key, placeLookupKey(36.21, -86.7816)), true);
  assert.equal(shouldRestartPlaceLookup(null, key), true);
});

test("coordsFromPlaceKey round-trips the lookup cell", () => {
  const key = placeLookupKey(36.1627, -86.7816);
  const coords = coordsFromPlaceKey(key);
  assert.equal(placeLookupKey(coords.lat, coords.lon), key);
});
