import test from "node:test";
import assert from "node:assert/strict";
import {
  INTERVAL_MAX,
  RITAM_PODRAZUMIJEVANI,
  intervalUzPrag,
  normalizujRitam,
  poIntervalu,
  ritamZapisan,
} from "./ritam-obnova.js";

test("normalizujRitam prima ispravan zapis", () => {
  assert.deepEqual(normalizujRitam({ strategija: "sve-dostupno" }), { strategija: "sve-dostupno" });
  assert.deepEqual(normalizujRitam({ strategija: "interval", dana: 3 }), { strategija: "interval", dana: 3 });
  assert.deepEqual(normalizujRitam({ strategija: "ravnomjerno", kada: "2026-07-31T00:00:00.000Z" }), {
    strategija: "ravnomjerno",
    kada: "2026-07-31T00:00:00.000Z",
  });
});

test("normalizujRitam pada na podrazumijevani kad je zapis pokvaren", () => {
  // Pokvaren zapis ne smije zaustaviti dnevnu obnovu: radi se kao i prije.
  for (const sirovo of [null, undefined, 42, "ravnomjerno", {}, { strategija: "izmisljena" }]) {
    assert.deepEqual(normalizujRitam(sirovo), RITAM_PODRAZUMIJEVANI, `${JSON.stringify(sirovo)}`);
  }
  // interval bez broja dana ili sa besmislenim brojem nije interval
  assert.deepEqual(normalizujRitam({ strategija: "interval" }), RITAM_PODRAZUMIJEVANI);
  assert.deepEqual(normalizujRitam({ strategija: "interval", dana: 0 }), RITAM_PODRAZUMIJEVANI);
  assert.deepEqual(normalizujRitam({ strategija: "interval", dana: INTERVAL_MAX + 1 }), RITAM_PODRAZUMIJEVANI);
});

test("ritamZapisan razlikuje odluku trgovca od podrazumijevanog", () => {
  // Po ovome bot odlucuje da li ga uopste vrijedi pitati za ritam.
  assert.equal(ritamZapisan(RITAM_PODRAZUMIJEVANI), false);
  assert.equal(ritamZapisan({ strategija: "ravnomjerno" }), false, "ista strategija, ali nije izabrana");
  assert.equal(ritamZapisan({ strategija: "ravnomjerno", kada: "2026-07-31T00:00:00.000Z" }), true);
});

test("intervalUzPrag ne dopusta cesce nego sto platforma daje", () => {
  // Trgovac koji kaze "svaki dan" ne moze dobiti svaki dan: besplatna obnova istog oglasa ide
  // tek nakon praga (olx://pravila-brojeva, Razred A). Bolje ispravljen broj nego prazno obecanje.
  assert.equal(intervalUzPrag(1, 7), 7);
  assert.equal(intervalUzPrag(3, 7), 7);
  assert.equal(intervalUzPrag(10, 7), 10, "duzi interval od praga je trgovceva stvar");
  assert.equal(intervalUzPrag(7, 7), 7);
});

test("poIntervalu propusta samo oglase kojima je proslo dovoljno", () => {
  const sada = 1_785_456_000;
  const DAN = 86_400;
  const oglasi = [
    { id: 1, zadnjaObnova: sada - 10 * DAN },
    { id: 2, zadnjaObnova: sada - 2 * DAN },
    { id: 3, zadnjaObnova: sada - 7 * DAN },
    { id: 4 }, // bez podatka o zadnjoj obnovi
  ];
  const naRedu = poIntervalu(oglasi, 7, sada).map((o) => o.id);
  assert.deepEqual(naRedu, [1, 3, 4], "oglas od 2 dana ceka, oglas bez podatka se propusta");
});
