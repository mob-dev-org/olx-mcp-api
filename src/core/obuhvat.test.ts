// Testovi za podijeliUKomade: dijeljenje dugog spiska u komade fiksne velicine.

import assert from "node:assert/strict";
import { test } from "node:test";
import { podijeliUKomade } from "./obuhvat.js";

test("prazan spisak daje jedan prazan komad", () => {
  const r = podijeliUKomade<number>([], 500, 1);
  assert.equal(r.komada_ukupno, 1);
  assert.equal(r.ukupno, 0);
  assert.deepEqual(r.stavke, []);
  assert.equal(r.ima_jos, false);
  assert.equal(r.van_opsega, false);
});

test("tacno 500 uz prag 500 je jedan komad bez nastavka", () => {
  const spisak = Array.from({ length: 500 }, (_, i) => i);
  const r = podijeliUKomade(spisak, 500, 1);
  assert.equal(r.komada_ukupno, 1);
  assert.equal(r.stavke.length, 500);
  assert.equal(r.ima_jos, false);
});

test("501 uz prag 500 daje dva komada, prvi ima_jos true, drugi ima jednu stavku", () => {
  const spisak = Array.from({ length: 501 }, (_, i) => i);
  const prvi = podijeliUKomade(spisak, 500, 1);
  assert.equal(prvi.komada_ukupno, 2);
  assert.equal(prvi.stavke.length, 500);
  assert.equal(prvi.ima_jos, true);

  const drugi = podijeliUKomade(spisak, 500, 2);
  assert.equal(drugi.komada_ukupno, 2);
  assert.equal(drugi.stavke.length, 1);
  assert.equal(drugi.stavke[0], 500);
  assert.equal(drugi.ima_jos, false);
});

test("trazeni komad van opsega vraca prazne stavke i van_opsega true, bez izuzetka", () => {
  const spisak = Array.from({ length: 501 }, (_, i) => i);
  const nula = podijeliUKomade(spisak, 500, 0);
  assert.equal(nula.van_opsega, true);
  assert.deepEqual(nula.stavke, []);
  assert.equal(nula.komada_ukupno, 2);

  const treci = podijeliUKomade(spisak, 500, 3);
  assert.equal(treci.van_opsega, true);
  assert.deepEqual(treci.stavke, []);
  assert.equal(treci.komada_ukupno, 2);
});

test("prag 0 ili negativan se tretira kao 1, ne dijeli sa nulom i ne baca", () => {
  const spisak = [1, 2, 3];
  const nula = podijeliUKomade(spisak, 0, 1);
  assert.equal(nula.komada_ukupno, 3);
  assert.deepEqual(nula.stavke, [1]);

  const negativan = podijeliUKomade(spisak, -5, 2);
  assert.equal(negativan.komada_ukupno, 3);
  assert.deepEqual(negativan.stavke, [2]);
});
