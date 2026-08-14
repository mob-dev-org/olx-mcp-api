// Testovi za podijeliUKomade: dijeljenje dugog spiska u komade fiksne velicine.

import assert from "node:assert/strict";
import { test } from "node:test";
import { odaberiStrategiju, podijeliUKomade, uputaZaNepotpun } from "./obuhvat.js";

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

test("odaberiStrategiju: bez ids i prazan niz idu na katalog", () => {
  assert.deepEqual(odaberiStrategiju(undefined), { nacin: "katalog", broj: 0 });
  assert.deepEqual(odaberiStrategiju([]), { nacin: "katalog", broj: 0 });
});

test("odaberiStrategiju: 1 id i tacno prag ide po_id, iznad praga ide katalog", () => {
  assert.deepEqual(odaberiStrategiju([1]), { nacin: "po_id", broj: 1 });
  const na60 = Array.from({ length: 60 }, (_, i) => i);
  assert.deepEqual(odaberiStrategiju(na60), { nacin: "po_id", broj: 60 });
  const na61 = Array.from({ length: 61 }, (_, i) => i);
  assert.deepEqual(odaberiStrategiju(na61), { nacin: "katalog", broj: 61 });
});

test("uputaZaNepotpun: budzet i osigurac spominju ids i CLI, ne spominju category_id", () => {
  for (const razlog of ["budzet", "osigurac"]) {
    const tekst = uputaZaNepotpun(razlog, "Promjena cijene", 5, 10);
    assert.match(tekst, /ids/);
    assert.match(tekst, /CLI/);
    assert.doesNotMatch(tekst, /category_id/);
  }
});

test("uputaZaNepotpun: katalog_se_mijenjao spominje ponovni pokusaj, ne spominje category_id", () => {
  const tekst = uputaZaNepotpun("katalog_se_mijenjao", "Sklanjanje oglasa", 8, 8);
  assert.match(tekst, /ponovni pokusaj|pokusano ponovo/);
  assert.doesNotMatch(tekst, /category_id/);
});

test("uputaZaNepotpun: nepoznat ili nedostajuci razlog daje opsti tekst bez izmisljanja uzroka i bez category_id", () => {
  const nepoznat = uputaZaNepotpun("neki-novi-razlog", "Sklanjanje oglasa", 1, 2);
  assert.doesNotMatch(nepoznat, /category_id/);
  const nedostaje = uputaZaNepotpun(undefined, "Sklanjanje oglasa", 1, 2);
  assert.match(nedostaje, /nepoznat/);
  assert.doesNotMatch(nedostaje, /category_id/);
});

// "Suzi na category_id" se nigdje ne smije pojaviti: katalog se cita PRIJE filtriranja po
// category_id, pa taj savjet ne bi promijenio broj procitanih stranica i pozivalac bi dobio
// istu gresku ponovo. Ova provjera je izricita da neko slucajno ne vrati savjet nazad.
test("uputaZaNepotpun: nijedna varijanta ne savjetuje suzavanje kroz category_id", () => {
  const svi = [
    uputaZaNepotpun("budzet", "X", 1, 2),
    uputaZaNepotpun("osigurac", "X", 1, 2),
    uputaZaNepotpun("katalog_se_mijenjao", "X", 1, 2),
    uputaZaNepotpun(undefined, "X", 1, 2),
    uputaZaNepotpun("nepoznat", "X", 1, 2),
  ];
  for (const tekst of svi) assert.doesNotMatch(tekst, /category_id/);
});
