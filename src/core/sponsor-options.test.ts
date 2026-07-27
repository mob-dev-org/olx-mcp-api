// Testovi sklapanja opcija izdvajanja: homepage i locations se spajaju bez duplikata,
// nevalidne vrijednosti padaju sa jasnom porukom.

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSponsorOptions } from "./sponsor-options.js";

test("homepage flag daje locations ['homepage']", () => {
  const options = parseSponsorOptions({ type: 1, days: 5, homepage: true });
  assert.deepEqual(options.locations, ["homepage"]);
});

test("bez homepage i bez locations nema locations polja", () => {
  const options = parseSponsorOptions({ type: 1, days: 5 });
  assert.equal(options.locations, undefined);
});

test("homepage i locations se spajaju bez duplikata", () => {
  const options = parseSponsorOptions({
    type: 2,
    days: 7,
    refreshEvery: 8,
    homepage: true,
    locations: ["homepage", "search-top", "  ", "search-top"],
  });
  assert.deepEqual(options.locations, ["homepage", "search-top"]);
});

test("locations bez homepage flaga prolaze same", () => {
  const options = parseSponsorOptions({ type: 1, days: 3, locations: ["homepage"] });
  assert.deepEqual(options.locations, ["homepage"]);
});

test("prazan locations niz daje undefined", () => {
  const options = parseSponsorOptions({ type: 1, days: 3, locations: [] });
  assert.equal(options.locations, undefined);
});

test("refreshEvery default je 0 i uvijek se posalje", () => {
  const options = parseSponsorOptions({ type: 1, days: 5 });
  assert.equal(options.refresh_every, 0);
});

test("nevalidan tip, dani i razmak obnove padaju sa porukom dozvoljenih vrijednosti", () => {
  assert.throws(() => parseSponsorOptions({ type: 3, days: 5 }), /Tip izdvajanja/);
  assert.throws(() => parseSponsorOptions({ type: 1, days: 15 }), /Broj dana/);
  assert.throws(() => parseSponsorOptions({ type: 1, days: 5, refreshEvery: 12 }), /Razmak autoobnove/);
});
