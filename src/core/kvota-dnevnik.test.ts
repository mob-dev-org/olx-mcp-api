import test from "node:test";
import assert from "node:assert/strict";
import { daniResetaKvote, type RedKvote } from "./kvota-dnevnik.js";

function red(dan: string, freeCount: number, aktivnih = 121): RedKvote {
  return { dan, free_count: freeCount, free_limit: 1800, aktivnih };
}

test("daniResetaKvote nadje dan kad je potroseno palo", () => {
  // Ovo je cijela svrha dnevnika: API ne vraca datum reseta kvote, pa se dan reseta prepoznaje
  // po tome da potroseno skoci nazad. Unutar istog ciklusa potroseno moze samo rasti.
  const redovi = [
    red("2026-07-29", 300),
    red("2026-07-30", 310),
    red("2026-07-31", 318),
    red("2026-08-01", 330), // nije reset: raste dalje, dakle NE vazi kalendarski mjesec
    red("2026-08-23", 480),
    red("2026-08-24", 12), // reset: ciklus pretplate
    red("2026-08-25", 30),
  ];
  assert.deepEqual(daniResetaKvote(redovi), ["2026-08-24"]);
});

test("daniResetaKvote ne javlja reset kad potroseno samo raste", () => {
  assert.deepEqual(daniResetaKvote([red("2026-07-29", 300), red("2026-07-30", 310)]), []);
  assert.deepEqual(daniResetaKvote([red("2026-07-29", 300)]), [], "jedan zapis nema sa cim porediti");
  assert.deepEqual(daniResetaKvote([]), []);
});

test("daniResetaKvote nadje vise resetova kroz duzu seriju", () => {
  const redovi = [red("2026-06-24", 400), red("2026-06-25", 5), red("2026-07-23", 460), red("2026-07-24", 8)];
  assert.deepEqual(daniResetaKvote(redovi), ["2026-06-25", "2026-07-24"]);
});
